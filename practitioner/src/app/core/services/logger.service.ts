import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

export enum LogLevel {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
}

@Injectable({
  providedIn: 'root',
})
export class LoggerService {
  private logLevel: LogLevel = environment.production
    ? LogLevel.Warn
    : LogLevel.Debug;

  error(message: string, ...args: unknown[]): void {
    if (this.logLevel >= LogLevel.Error) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.logLevel >= LogLevel.Warn) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.logLevel >= LogLevel.Info) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.logLevel >= LogLevel.Debug) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }
}
