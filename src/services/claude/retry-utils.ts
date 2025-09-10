import { ExecaError } from 'execa';

export interface RetryConfig {
  maxRetries: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
  maxRetryDelay: number;
  verbose?: boolean;
}

export interface RetryResult<T> {
  result: T;
  retryAttempts: number;
}

export class RetryableError extends Error {
  constructor(message: string, public readonly originalError?: any) {
    super(message);
    this.name = 'RetryableError';
  }
}

export function isRetryableError(error: any): boolean {
  // Exit codes 1-2 are considered retryable
  if (error.exitCode !== undefined && error.exitCode >= 1 && error.exitCode <= 2) {
    return true;
  }
  
  // Timeout errors are retryable
  if (error.timedOut || error.code === 'ETIMEDOUT') {
    return true;
  }
  
  // Network-related errors are retryable
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'EPIPE') {
    return true;
  }
  
  // Non-retryable errors
  if (error.exitCode === 127) { // Command not found
    return false;
  }
  
  if (error.code === 'ENOENT') { // File not found
    return false;
  }
  
  if (error.code === 'EACCES' || error.code === 'EPERM') { // Permission errors
    return false;
  }
  
  // Default to not retrying unknown errors
  return false;
}

export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  // Calculate exponential backoff with cap
  const delay = Math.min(
    config.retryDelay * Math.pow(config.retryBackoffMultiplier, attempt),
    config.maxRetryDelay
  );
  
  // Add jitter (10% randomness) to prevent thundering herd
  const jitter = delay * 0.1 * Math.random();
  
  return Math.floor(delay + jitter);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  operationName: string = 'operation'
): Promise<RetryResult<T>> {
  let lastError: any;
  let retryAttempts = 0;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        retryAttempts = attempt;
        const delay = calculateBackoffDelay(attempt - 1, config);
        
        if (config.verbose) {
          console.log(`🔄 Retry attempt ${attempt}/${config.maxRetries} for ${operationName} after ${delay}ms delay`);
        }
        
        await sleep(delay);
      }
      
      const result = await operation();
      
      if (attempt > 0 && config.verbose) {
        console.log(`✅ ${operationName} succeeded after ${attempt} retry attempt(s)`);
      }
      
      return {
        result,
        retryAttempts
      };
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      if (!isRetryableError(error)) {
        if (config.verbose && attempt > 0) {
          console.log(`❌ Non-retryable error encountered for ${operationName}: ${error.message}`);
        }
        throw error; // Don't retry non-retryable errors
      }
      
      // Check if we've exhausted retries
      if (attempt === config.maxRetries) {
        if (config.verbose) {
          console.log(`❌ Max retries (${config.maxRetries}) exhausted for ${operationName}`);
        }
        throw new RetryableError(
          `${operationName} failed after ${config.maxRetries} retry attempts: ${error.message}`,
          error
        );
      }
      
      if (config.verbose) {
        console.log(`⚠️  ${operationName} failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${error.message}`);
      }
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatRetryStats(retryAttempts: number): string {
  if (retryAttempts === 0) {
    return '';
  }
  return ` (after ${retryAttempts} retr${retryAttempts === 1 ? 'y' : 'ies'})`;
}