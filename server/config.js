import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  authUser: process.env.AUTH_USER || 'admin',
  authPass: process.env.AUTH_PASS || 'secret',
  audioDir: path.resolve(process.env.AUDIO_DIR || path.join(__dirname, '..', 'audio')),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  isProd: process.env.NODE_ENV === 'production',
};
