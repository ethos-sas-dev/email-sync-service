import { DetailedEmail, EmailStatus, SyncStats } from '../types';
import { formatDate } from '../utils';
import { fetchDetailedEmails, fetchEmailIds } from './email';
import { getEmailsFromStrapi, syncEmailWithStrapi } from './strapi';

class SyncManager {
  private syncInProgress: boolean = false;
  private stats: SyncStats = {
    processedCount: 0,
    totalCount: 0,
    newEmails: 0,
    errors: 0,
    inProgress: false,
    startTime: new Date(),
    lastUpdated: new Date()
  };
  
  /**
   * Obtiene las estadísticas actuales de sincronización
   */
  public getStats(): SyncStats {
    return { ...this.stats };
  }
  
  /**
   * Inicia una sincronización completa de correos
   */
  public async startSync(): Promise<SyncStats> {
    if (this.syncInProgress) {
      console.log('Sincronización ya en progreso, ignorando solicitud');
      return this.getStats();
    }
    
    try {
      // Marcar inicio de sincronización
      this.syncInProgress = true;
      this.stats = {
        processedCount: 0,
        totalCount: 0,
        newEmails: 0,
        errors: 0,
        inProgress: true,
        startTime: new Date(),
        lastUpdated: new Date()
      };
      
      console.log(`[${formatDate(this.stats.startTime)}] Iniciando sincronización de correos`);
      
      // Obtener correos existentes desde Strapi
      const existingEmails = await getEmailsFromStrapi();
      const existingIds = new Set(existingEmails.map(email => email.emailId));
      
      console.log(`Encontrados ${existingIds.size} correos existentes en Strapi`);
      
      // Obtener todos los IDs de correos desde el servidor IMAP
      const allEmailIds = await fetchEmailIds();
      console.log(`Encontrados ${allEmailIds.length} correos en el servidor IMAP`);
      
      // Filtrar solo los IDs que no existen en Strapi
      const newEmailIds = allEmailIds.filter(id => !existingIds.has(id));
      console.log(`Detectados ${newEmailIds.length} correos nuevos para sincronizar`);
      
      // Actualizar estadísticas
      this.stats.totalCount = newEmailIds.length;
      this.stats.lastUpdated = new Date();
      
      if (newEmailIds.length === 0) {
        console.log('No hay correos nuevos para sincronizar');
        this.stats.inProgress = false;
        this.stats.endTime = new Date();
        this.syncInProgress = false;
        return this.getStats();
      }
      
      // Procesar en lotes pequeños
      const batchSize = 10;
      for (let i = 0; i < newEmailIds.length; i += batchSize) {
        const batch = newEmailIds.slice(i, i + batchSize);
        
        try {
          console.log(`Procesando lote ${i/batchSize + 1} de ${Math.ceil(newEmailIds.length/batchSize)}`);
          
          // Obtener detalles de los correos (incluyendo cuerpo completo)
          const detailedEmails = await fetchDetailedEmails(batch);
          
          // Log detallado de los correos obtenidos
          console.log(`Detalles obtenidos para ${detailedEmails.length} correos:`);
          detailedEmails.forEach(email => {
            console.log(`📧 Correo ${email.emailId} - Asunto: ${email.subject?.substring(0, 30) || '(sin asunto)'}... - Contenido: ${email.fullContent ? 'Sí (' + email.fullContent.length + ' bytes)' : 'No'}`);
          });
          
          // Sincronizar cada correo con Strapi
          const syncPromises = detailedEmails.map(async (email) => {
            try {
              const result = await syncEmailWithStrapi(email);
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
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (batchError) {
          console.error(`Error al procesar lote de correos:`, batchError);
          this.stats.errors += batch.length;
          this.stats.processedCount += batch.length;
        }
      }
      
      // Marcar finalización
      this.stats.inProgress = false;
      this.stats.endTime = new Date();
      this.syncInProgress = false;
      
      const duration = (this.stats.endTime.getTime() - this.stats.startTime.getTime()) / 1000;
      console.log(`Sincronización completada en ${duration.toFixed(2)} segundos. ${this.stats.newEmails} correos nuevos, ${this.stats.errors} errores`);
      
      return this.getStats();
    } catch (error) {
      console.error('Error durante la sincronización:', error);
      this.stats.errors++;
      this.stats.inProgress = false;
      this.stats.endTime = new Date();
      this.syncInProgress = false;
      return this.getStats();
    }
  }
  
  /**
   * Verifica si hay una sincronización en progreso
   */
  public isSyncInProgress(): boolean {
    return this.syncInProgress;
  }
}

// Exportar una instancia singleton
export const syncManager = new SyncManager(); 