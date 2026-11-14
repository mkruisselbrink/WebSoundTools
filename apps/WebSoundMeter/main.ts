// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

import { registerOfflineServiceWorker } from '@foh/pwa/client';
import './src/ui/app-shell.js';

void registerOfflineServiceWorker();
