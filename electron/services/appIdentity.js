import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, APP_NAME } from './identityConfig.js';

// 必须在 electron-store、日志和浏览器会话初始化前执行。
// 仅使用 MicoMusic 自己的目录，不读取或迁移 MoeKoe Music 数据。
app.setName(APP_NAME);
const userDataPath = path.join(app.getPath('appData'), APP_NAME);
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);
app.setPath('sessionData', userDataPath);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
