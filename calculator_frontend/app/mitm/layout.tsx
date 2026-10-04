import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Equation Search · Constant Recognition',
  description: 'Meet-in-the-middle search for equations L(x) = R that a number satisfies',
};

export default function MitmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
