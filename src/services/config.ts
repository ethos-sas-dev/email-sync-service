import dotenv from 'dotenv';
import { ImapConfig, StrapiConfig } from '../types';

// Cargar variables de entorno
dotenv.config();

/**
 * Obtiene la configuración IMAP desde las variables de entorno
 */
export function getImapConfig(): ImapConfig {
  return {
    user: process.env.EMAIL_USER || 'administraciona3@almax.ec',
    password: process.env.EMAIL_PASSWORD || '',
    host: process.env.EMAIL_HOST || 'pop.telconet.cloud',
    port: parseInt(process.env.EMAIL_PORT || '993', 10),
    tls: true,
    authTimeout: 30000,
    tlsOptions: { 
      rejectUnauthorized: process.env.NODE_ENV === 'production' 
    }
  };
}

/**
 * Obtiene la configuración de Strapi
 */
export function getStrapiConfig(): StrapiConfig {
  return {
    graphqlUrl: process.env.GRAPHQL_URL || '',
    apiToken: process.env.STRAPI_API_TOKEN || ''
  };
}

/**
 * Obtiene el puerto para el servidor
 */
export function getServerPort(): number {
  return parseInt(process.env.PORT || '3030', 10);
}

/**
 * Obtiene la expresión cron para sincronización programada
 */
export function getSyncCronExpression(): string {
  return process.env.SYNC_CRON || '*/15 * * * *'; // Por defecto, cada 15 minutos
} 