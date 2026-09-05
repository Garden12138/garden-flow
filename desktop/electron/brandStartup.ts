import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import identity from '../shared/brand.generated.json';

const userData = process.env.GARDENFLOW_USER_DATA_DIR || path.join(app.getPath('appData'), identity.displayName);
fs.mkdirSync(userData, { recursive: true });
app.setName(identity.displayName);
app.setPath('userData', userData);
app.setPath('sessionData', userData);
