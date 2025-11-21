/**
 * Supabase Query Logger
 *
 * Utilitário para logar todas as queries do Supabase de forma estruturada.
 * Pode ser usado com ou sem o logger do Mastra.
 */

export interface SupabaseQueryLog {
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'RPC';
  table: string;
  filters?: Record<string, any>;
  duration_ms: number;
  rows_returned?: number;
  error?: string;
  query_name?: string;
}

export interface SupabaseLoggerOptions {
  /** Se true, loga no console mesmo sem logger do Mastra */
  alwaysLogToConsole?: boolean;
  /** Prefixo para os logs */
  prefix?: string;
}

const defaultOptions: SupabaseLoggerOptions = {
  alwaysLogToConsole: true,
  prefix: '[Supabase]',
};

/**
 * Executa uma query do Supabase com logging automático
 */
export async function executeWithLogging<T>(
  queryName: string,
  table: string,
  filters: Record<string, any>,
  queryFn: () => Promise<{ data: T | null; error: any }>,
  logger?: any,
  options: SupabaseLoggerOptions = {}
): Promise<{ data: T | null; error: any }> {
  const opts = { ...defaultOptions, ...options };
  const startTime = Date.now();

  // Log início da query
  const startMessage = `${opts.prefix} Executing: ${queryName} on ${table}`;
  const filterInfo = Object.keys(filters).length > 0
    ? ` | Filters: ${JSON.stringify(filters)}`
    : '';

  if (logger) {
    logger.info(`${startMessage}${filterInfo}`);
  } else if (opts.alwaysLogToConsole) {
    console.log(`${startMessage}${filterInfo}`);
  }

  // Executa a query
  const result = await queryFn();
  const duration = Date.now() - startTime;

  // Log resultado
  if (result.error) {
    const errorMessage = `${opts.prefix} FAILED: ${queryName} - ${result.error.message || result.error} (${duration}ms)`;

    if (logger) {
      logger.error(errorMessage);
    } else if (opts.alwaysLogToConsole) {
      console.error(errorMessage);
    }
  } else {
    const rowCount = Array.isArray(result.data)
      ? result.data.length
      : result.data ? 1 : 0;

    const successMessage = `${opts.prefix} OK: ${queryName} | ${rowCount} rows | ${duration}ms`;

    if (logger) {
      logger.info(successMessage);
    } else if (opts.alwaysLogToConsole) {
      console.log(successMessage);
    }
  }

  return result;
}

/**
 * Logger simples para quando não temos acesso ao logger do Mastra
 */
export const supabaseConsoleLogger = {
  info: (message: string) => {
    console.log(`\x1b[36m[Supabase]\x1b[0m ${message}`);
  },
  error: (message: string) => {
    console.error(`\x1b[31m[Supabase ERROR]\x1b[0m ${message}`);
  },
  warn: (message: string) => {
    console.warn(`\x1b[33m[Supabase WARN]\x1b[0m ${message}`);
  },
  debug: (message: string) => {
    if (process.env.DEBUG === 'true' || process.env.SUPABASE_DEBUG === 'true') {
      console.log(`\x1b[90m[Supabase DEBUG]\x1b[0m ${message}`);
    }
  },
};

/**
 * Helper para criar um wrapper de logging para qualquer cliente Supabase
 */
export function createLoggingWrapper(supabaseClient: any, logger?: any) {
  return {
    from: (table: string) => {
      const originalFrom = supabaseClient.from(table);

      return {
        ...originalFrom,
        select: (...args: any[]) => {
          const query = originalFrom.select(...args);
          const originalExecute = query.then.bind(query);

          query.then = async (resolve: any, reject: any) => {
            const startTime = Date.now();
            try {
              const result = await originalExecute((res: any) => res);
              const duration = Date.now() - startTime;
              const rowCount = Array.isArray(result.data) ? result.data.length : 0;

              const message = `SELECT from ${table} | ${rowCount} rows | ${duration}ms`;
              if (logger) {
                logger.info(`[Supabase] ${message}`);
              } else {
                console.log(`\x1b[36m[Supabase]\x1b[0m ${message}`);
              }

              return resolve ? resolve(result) : result;
            } catch (error) {
              if (reject) reject(error);
              throw error;
            }
          };

          return query;
        },
      };
    },
  };
}

/**
 * Decorator para adicionar logging automático a métodos que fazem queries
 */
export function LogSupabaseQuery(queryName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      console.log(`\x1b[36m[Supabase]\x1b[0m Starting: ${queryName}`);

      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        console.log(`\x1b[36m[Supabase]\x1b[0m Completed: ${queryName} | ${duration}ms`);
        return result;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        console.error(`\x1b[31m[Supabase ERROR]\x1b[0m Failed: ${queryName} | ${duration}ms | ${error.message}`);
        throw error;
      }
    };

    return descriptor;
  };
}
