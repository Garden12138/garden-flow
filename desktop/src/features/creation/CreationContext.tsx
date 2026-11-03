import { createContext, type ReactNode } from 'react';

export const CreationContext = createContext<{ content: ReactNode; versions?: ReactNode } | null>(null);
