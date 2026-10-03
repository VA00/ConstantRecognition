"""Run a command and measure what a user would feel: wall time, peak memory (the process and its
children), and the responsiveness of the machine (how long a trivial child process takes to start,
probed every 2 s). The command is killed at a memory cap or a time limit."""
import subprocess, threading, time
import psutil


def _probe_latency():
    t0 = time.perf_counter()
    subprocess.run(["cmd", "/c", "exit"], capture_output=True)
    return time.perf_counter() - t0


def run(cmd, stdin_text=None, mem_cap_gb=12.0, time_limit=600.0):
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out = {}
    def comm():
        out["stdout"], out["stderr"] = p.communicate(stdin_text)
    th = threading.Thread(target=comm); th.start()
    ps = psutil.Process(p.pid)
    peak = 0; probes = []; killed = None; t0 = time.time(); last_probe = 0.0
    while th.is_alive():
        try:
            rss = ps.memory_info().rss + sum(c.memory_info().rss for c in ps.children(recursive=True))
            peak = max(peak, rss)
        except psutil.Error:
            pass
        now = time.time()
        if now - last_probe > 2.0:
            probes.append(_probe_latency()); last_probe = now
        if peak > mem_cap_gb * 2**30 and killed is None:
            killed = "memory cap"; p.kill()
        if now - t0 > time_limit and killed is None:
            killed = "time limit"; p.kill()
        th.join(timeout=0.1)
    return {"stdout": out.get("stdout", ""), "stderr": out.get("stderr", ""), "seconds": time.time() - t0,
            "peak_gb": peak / 2**30, "probe_max_s": max(probes) if probes else None,
            "probe_median_s": sorted(probes)[len(probes) // 2] if probes else None, "killed": killed}
