// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { initThal } from './lib/wasm/thal';
import './index.css';

// primer3's thermodynamics answers the Tm and secondary-structure readouts the
// inspector shows as the selection changes, so it has to be there before the
// first render rather than arriving later and changing the numbers. It is
// 400 kB and loads in a few tens of milliseconds.
await initThal();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
