import { formatDate } from '../utils';
import { syncManager } from '../services/sync';

/**
 * Script para ejecutar una sincronización manual de correos
 * Úsalo con: npm run sync
 */
async function main() {
  console.log(`📧 Iniciando sincronización manual de correos - ${formatDate(new Date())}`);
  
  try {
    // Iniciar sincronización
    const stats = await syncManager.startSync();
    
    console.log('✅ Sincronización completada:');
    console.log(`- Total correos procesados: ${stats.processedCount} / ${stats.totalCount}`);
    console.log(`- Correos nuevos sincronizados: ${stats.newEmails}`);
    console.log(`- Errores: ${stats.errors}`);
    
    if (stats.startTime && stats.endTime) {
      const duration = (stats.endTime.getTime() - stats.startTime.getTime()) / 1000;
      console.log(`- Duración: ${duration.toFixed(2)} segundos`);
    }
    
    // Salir con éxito
    process.exit(0);
  } catch (error) {
    console.error('❌ Error durante la sincronización:', error);
    // Salir con código de error
    process.exit(1);
  }
}

// Ejecutar la función principal
main().catch(error => {
  console.error('❌ Error fatal:', error);
  process.exit(1);
}); 