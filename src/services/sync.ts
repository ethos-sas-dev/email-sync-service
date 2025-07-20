import { DetailedEmail, EmailStatus, SyncStats } from '../types';
import { formatDate } from '../utils';
import { fetchDetailedEmails, fetchEmailIds } from './email';
import { getEmailsFromStrapi, syncEmailWithStrapi } from './strapi';

class SyncManager {
  private syncInProgress: boolean = false;
  private syncStartTime: Date | null = null;
  private syncTimeoutMs: number = 10 * 60 * 1000; // 10 minutos timeout
  private stats: SyncStats = {
    processedCount: 0,
    totalCount: 0,
    newEmails: 0,
    errors: 0,
    inProgress: false,
    startTime: new Date(),
    lastUpdated: new Date()
  };
  
  constructor() {
    // Verificar si hay sincronizaciones colgadas cada 2 minutos
    setInterval(() => {
      this.checkForHangingSync();
    }, 2 * 60 * 1000);
  }
  
  /**
   * Verifica si hay una sincronización colgada y la resetea
   */
  private checkForHangingSync(): void {
    if (this.syncInProgress && this.syncStartTime) {
      const now = new Date();
      const elapsed = now.getTime() - this.syncStartTime.getTime();
      
      if (elapsed > this.syncTimeoutMs) {
        console.warn(`⚠️  TIMEOUT: Sincronización colgada detectada (${Math.round(elapsed / 1000)}s). Reseteando estado...`);
        this.forceReset();
      }
    }
  }
  
  /**
   * Fuerza el reset del estado de sincronización
   */
  public forceReset(): void {
    console.log('🔄 Forzando reset del estado de sincronización...');
    this.syncInProgress = false;
    this.syncStartTime = null;
    this.stats.inProgress = false;
    this.stats.endTime = new Date();
    console.log('✅ Estado de sincronización reseteado');
  }
  
  /**
   * Obtiene las estadísticas actuales de sincronización
   */
  public getStats(): SyncStats {
    return { ...this.stats };
  }
  
  /**
   * Verifica si hay una sincronización en progreso (con verificación de timeout)
   */
  public isSyncInProgress(): boolean {
    // Verificar timeout antes de responder
    this.checkForHangingSync();
    return this.syncInProgress;
  }
  
  /**
   * Inicia una sincronización completa de correos con timeout automático
   */
  public async startSync(): Promise<SyncStats> {
    // Verificar si hay sincronización colgada antes de empezar
    this.checkForHangingSync();
    
    if (this.syncInProgress) {
      console.log('Sincronización ya en progreso, ignorando solicitud');
      return this.getStats();
    }
    
    // Marcar inicio de sincronización
    this.syncInProgress = true;
    this.syncStartTime = new Date();
    this.stats = {
      processedCount: 0,
      totalCount: 0,
      newEmails: 0,
      errors: 0,
      inProgress: true,
      startTime: this.syncStartTime,
      lastUpdated: new Date()
    };
    
    console.log(`[${formatDate(this.stats.startTime)}] Iniciando sincronización de correos`);
    
    try {
      // Obtener correos existentes desde Strapi
      const existingEmails = await this.executeWithTimeout(
        getEmailsFromStrapi(),
        60000, // 60 segundos timeout para Strapi (ahora puede paginar)
        'getEmailsFromStrapi'
      );
      const existingIds = new Set(existingEmails.map(email => email.emailId));

      // Calcular la fecha más reciente de los correos ya guardados
      const latestDate = existingEmails.reduce((max, email) => {
        const d = new Date(email.receivedDate);
        return d > max ? d : max;
      }, new Date(0));
      console.log(`Última fecha registrada en Strapi: ${latestDate.toISOString()}`);
      
      console.log(`Encontrados ${existingIds.size} correos existentes en Strapi`);
      
      // Obtener IDs de correos desde el servidor IMAP que sean posteriores a latestDate
      const allEmailIds = await this.executeWithTimeout(
        fetchEmailIds(latestDate),
        180000, // 3 minutos timeout para IMAP
        'fetchEmailIds'
      );
      console.log(`Encontrados ${allEmailIds.length} correos en el servidor IMAP`);
      
      // Filtrar solo los IDs que no existen en Strapi
      const newEmailIds = allEmailIds.filter(id => !existingIds.has(id));
      console.log(`Detectados ${newEmailIds.length} correos nuevos para sincronizar`);
      
      // Actualizar estadísticas
      this.stats.totalCount = newEmailIds.length;
      this.stats.lastUpdated = new Date();
      
      if (newEmailIds.length === 0) {
        console.log('No hay correos nuevos para sincronizar');
        this.finishSync();
        return this.getStats();
      }
      
      // Procesar de a un correo a la vez para minimizar uso de memoria
      const batchSize = 5;
      for (let i = 0; i < newEmailIds.length; i += batchSize) {
        // Verificar si hemos excedido el tiempo limite
        if (this.syncStartTime && (new Date().getTime() - this.syncStartTime.getTime()) > this.syncTimeoutMs) {
          throw new Error('Timeout de sincronización excedido');
        }
        
        const batch = newEmailIds.slice(i, i + batchSize);
        
        try {
          console.log(`Procesando lote ${Math.floor(i/batchSize) + 1} de ${Math.ceil(newEmailIds.length/batchSize)}`);
          
          // Obtener detalles de los correos con timeout
          const detailedEmails = await this.executeWithTimeout(
            fetchDetailedEmails(batch),
            120000, // 2 minutos timeout por lote
            `fetchDetailedEmails batch ${Math.floor(i/batchSize) + 1}`
          );
          
          // Sincronizar cada correo con Strapi
          const syncPromises = detailedEmails.map(async (email) => {
            try {
              const result = await this.executeWithTimeout(
                syncEmailWithStrapi(email),
                30000, // 30 segundos timeout por email
                `syncEmailWithStrapi ${email.emailId}`
              );
              
              if (result) {
                this.stats.newEmails++;
              } else {
                this.stats.errors++;
              }
            } catch (error) {
              console.error(`Error al sincronizar correo ${email.emailId}:`, error);
              this.stats.errors++;
            }
          });
          
          // Esperar a que se completen todas las sincronizaciones del lote
          await Promise.all(syncPromises);
          
          // Actualizar contador de procesados
          this.stats.processedCount += batch.length;
          this.stats.lastUpdated = new Date();
          
          console.log(`Progreso: ${this.stats.processedCount}/${this.stats.totalCount} correos procesados`);
          
          // Pequeña pausa para no sobrecargar servidores
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Forzar recolección de basura después de cada lote
          if (global.gc) {
            global.gc();
          }
        } catch (batchError) {
          console.error(`Error al procesar lote de correos:`, batchError);
          this.stats.errors += batch.length;
          this.stats.processedCount += batch.length;
        }
      }
      
      // Marcar finalización exitosa
      this.finishSync();
      
      const duration = (this.stats.endTime!.getTime() - this.stats.startTime.getTime()) / 1000;
      console.log(`✅ Sincronización completada en ${duration.toFixed(2)} segundos. ${this.stats.newEmails} correos nuevos, ${this.stats.errors} errores`);
      
      return this.getStats();
    } catch (error) {
      console.error('❌ Error durante la sincronización:', error);
      this.stats.errors++;
      this.finishSync();
      return this.getStats();
    }
  }
  
  /**
   * Ejecuta una promesa con timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number, 
    operationName: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout de ${timeoutMs}ms excedido para operación: ${operationName}`));
      }, timeoutMs);
      
      promise
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
  
  /**
   * Finaliza la sincronización y limpia el estado
   */
  private finishSync(): void {
    this.stats.inProgress = false;
    this.stats.endTime = new Date();
    this.syncInProgress = false;
    this.syncStartTime = null;
  }
}

// Exportar una instancia singleton
export const syncManager = new SyncManager();