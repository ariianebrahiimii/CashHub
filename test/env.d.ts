declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}

// types/env.d.ts
interface Env {
	DB: D1Database;
	TELEGRAM_TOKEN: string;
  }
  
  declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
  }