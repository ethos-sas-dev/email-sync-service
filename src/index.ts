import express, { Request, Response } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { getServerPort, getSyncCronExpression } from './services/config';
import { syncManager } from './services/sync';
import { fetchEmailContent } from './services/email';
import { getEmailsFromStrapi, updateEmailStatus } from './services/strapi';
import { formatDate } from './utils';
import { EmailStatus } from './types';

// Crear aplicación Express
const app = express();

// Configurar middleware
app.use(cors());
app.use(express.json());

// Ruta para verificar que el servidor está funcionando
app.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Servicio de sincronización de correos funcionando correctamente',
    version: '1.0.0'
  });
});

app.post('/api/sync/reset', (req, res) => {
  try {
    syncManager.forceReset();
    res.json({ 
      success: true, 
      message: 'Estado de sincronización reseteado exitosamente',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error al resetear sincronización:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor',
      message: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Endpoint mejorado para obtener el estado
app.get('/api/sync/status', (req, res) => {
  try {
    const stats = syncManager.getStats();
    const isHanging = syncManager.isSyncInProgress() && stats.startTime && 
                      (new Date().getTime() - stats.startTime.getTime()) > (8 * 60 * 1000); // 8 minutos
    
    res.json({
      ...stats,
      isHanging: isHanging,
      canReset: syncManager.isSyncInProgress()
    });
  } catch (error) {
    console.error('Error al obtener estado:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor' 
    });
  }
});

// Ruta para iniciar una sincronización manualmente
app.post('/api/sync/start', async (req: Request, res: Response) => {
  if (syncManager.isSyncInProgress()) {
    return res.status(409).json({
      success: false,
      message: 'Ya hay una sincronización en progreso'
    });
  }
  
  // Iniciar sincronización en segundo plano
  syncManager.startSync().catch(error => {
    console.error('Error durante la sincronización:', error);
  });
  
  res.json({
    success: true,
    message: 'Sincronización iniciada en segundo plano',
    stats: syncManager.getStats()
  });
});

// Ruta para obtener todos los correos desde Strapi
app.get('/api/emails', async (req: Request, res: Response) => {
  try {
    const emails = await getEmailsFromStrapi();
    
    // Calcular estadísticas
    const stats = {
      total: emails.length,
      necesitaAtencion: emails.filter(e => e.status === 'necesitaAtencion').length,
      informativo: emails.filter(e => e.status === 'informativo').length,
      respondido: emails.filter(e => e.status === 'respondido').length
    };
    
    res.json({ emails, stats });
  } catch (error) {
    console.error('Error al obtener correos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener correos',
      error: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Ruta para obtener el contenido completo de un correo
app.get('/api/emails/:emailId/content', async (req: Request, res: Response) => {
  try {
    const { emailId } = req.params;
    const emailContent = await fetchEmailContent(emailId);
    
    if (!emailContent) {
      return res.status(404).json({
        success: false,
        message: `Correo con ID ${emailId} no encontrado`
      });
    }
    
    res.json({
      success: true,
      email: emailContent
    });
  } catch (error) {
    console.error(`Error al obtener contenido del correo:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener contenido del correo',
      error: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Ruta para actualizar el estado de un correo
app.post('/api/emails/:emailId/status', async (req: Request, res: Response) => {
  try {
    const { emailId } = req.params;
    const { status, lastResponseBy } = req.body;
    
    // Validar status
    if (!status || !['necesitaAtencion', 'informativo', 'respondido'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido. Debe ser: necesitaAtencion, informativo o respondido'
      });
    }
    
    const result = await updateEmailStatus(emailId, status as EmailStatus, lastResponseBy);
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: `Error al actualizar estado del correo ${emailId}`
      });
    }
    
    res.json({
      success: true,
      message: `Estado del correo ${emailId} actualizado a ${status}`,
      emailId,
      status
    });
  } catch (error) {
    console.error(`Error al actualizar estado del correo:`, error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar estado del correo',
      error: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Iniciar el servidor
const PORT = getServerPort();
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en el puerto ${PORT}`);
  
  // Configurar tarea programada para sincronización
  const cronExpression = getSyncCronExpression();
  console.log(`⏰ Configurando sincronización automática: ${cronExpression}`);
  
  cron.schedule(cronExpression, async () => {
    console.log(`🔄 Ejecutando sincronización programada - ${formatDate(new Date())}`);
    
    if (!syncManager.isSyncInProgress()) {
      try {
        await syncManager.startSync();
      } catch (error) {
        console.error('Error en sincronización programada:', error);
      }
    } else {
      console.log('Omitiendo sincronización programada, ya hay una en progreso');
    }
  });
  
  // Realizar una sincronización inicial al arrancar (opcional)
  // Comentar esta línea si no quieres sincronización al inicio
  console.log('🚀 Iniciando sincronización inicial...');
  syncManager.startSync().catch(error => {
    console.error('Error en sincronización inicial:', error);
  });
});

// Manejo de cierre de la aplicación
process.on('SIGINT', () => {
  console.log('👋 Cerrando servidor de sincronización de correos...');
  process.exit(0);
}); 