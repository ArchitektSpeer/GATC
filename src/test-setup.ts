// GATC - Gene Assembly & Toolkit for Cloning
// Copyright (C) 2026 Xu Zhonghe
// SPDX-License-Identifier: GPL-3.0-or-later
// Without this the interface language would follow whatever the machine running the
// tests prefers, and the suites that assert on a message would pass locally and fail on
// a runner set to English. Tests that care about the other language set it themselves.
import { initPython } from './lib/python';
import { setLocale } from './lib/i18n';

setLocale('zh');

// The restriction engine is Bio.Restriction, which has to be running before any
// test touches it. Starting the interpreter is the one asynchronous step; every
// call into it afterwards is synchronous.
await initPython();
