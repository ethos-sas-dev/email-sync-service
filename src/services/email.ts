import ImapClient, { Message } from 'imap-simple';
import { simpleParser } from 'mailparser';
import { DetailedEmail } from '../types';
import { getImapConfig } from './config';
import { cleanEmailString, stripHtml } from '../utils';

/**
 * Parseamos manualmente los encabezados porque ImapClient.parseHeader no está disponible en los tipos
 */
function parseHeader(headerText: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  
  if (!headerText || typeof headerText !== 'string') {
    return result;
  }
  
  // Dividir por líneas
  const lines = headerText.split(/\r?\n/);
  let currentHeader = '';
  let currentValue = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Si la línea comienza con un espacio o tabulación, es una continuación
    if (/^\s+/.test(line) && currentHeader) {
      currentValue += ' ' + line.trim();
    } else {
      // Si teníamos un encabezado anterior, guardarlo
      if (currentHeader) {
        if (!result[currentHeader]) {
          result[currentHeader] = [];
        }
        result[currentHeader].push(currentValue.trim());
        currentValue = '';
      }
      
      // Nueva línea de encabezado
      const match = line.match(/^([^:]+):\s*(.*)/);
      if (match) {
        currentHeader = match[1].toLowerCase();
        currentValue = match[2];
      }
    }
  }
  
  // Guardar el último encabezado si existe
  if (currentHeader) {
    if (!result[currentHeader]) {
      result[currentHeader] = [];
    }
    result[currentHeader].push(currentValue.trim());
  }
  
  return result;
}

/**
 * Obtiene los IDs de correos desde el servidor IMAP
 */
export async function fetchEmailIds(sinceDate?: Date): Promise<string[]> {
  console.log('Obteniendo IDs de correos desde el servidor IMAP...');
  
  const imapConfig = {
    imap: {
      ...getImapConfig(),
      // Aumentar timeouts de IMAP
      authTimeout: 60000,   // 60 segundos para autenticación
      connTimeout: 60000,   // 60 segundos para conexión
      keepalive: {
        interval: 30000,    // Ping cada 30 segundos
        idleInterval: 300000, // 5 minutos
        forceNoop: true
      }
    }
  };
  
  let connection;
  try {
    console.log('🔗 Iniciando conexión IMAP...');
    const connectStart = Date.now();
    
    // Conectar al servidor IMAP
    connection = await ImapClient.connect(imapConfig);
    console.log(`✅ Conexión establecida en ${Date.now() - connectStart}ms`);
    
    console.log('📂 Abriendo bandeja INBOX...');
    const openStart = Date.now();
    
    // Abrir bandeja de entrada
    const box = await connection.openBox('INBOX');
    console.log(`✅ Bandeja INBOX abierta en ${Date.now() - openStart}ms`);
    console.log(`📊 Total de mensajes en INBOX: ${box.messages.total}`);
    console.log(`📊 Mensajes nuevos: ${box.messages.new}`);
    
    // Si hay demasiados correos, usar estrategia diferente
    if (box.messages.total > 10000) {
      console.log('⚠️  Bandeja grande detectada. Usando búsqueda optimizada...');
      return await fetchEmailIdsOptimized(connection, sinceDate);
    }
    
    console.log('🔍 Buscando todos los correos...');
    const searchStart = Date.now();
    
    // Obtener solo los IDs de los correos (sin contenido)
    const searchCriteria = sinceDate ? [['SINCE', sinceDate]] : ['ALL'];
    const fetchOptions = {
      bodies: [], // No obtener contenido, solo metadatos
      struct: false, // No necesitamos estructura
      envelope: false // No necesitamos envelope
    };
    
    // Obtener los mensajes
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`✅ Búsqueda completada en ${Date.now() - searchStart}ms`);
    console.log(`📊 Encontrados ${messages.length} correos en el servidor`);
    
    // Extraer solo los IDs
    const emailIds = messages.map((msg: Message) => String(msg.attributes.uid));
    
    return emailIds;
  } catch (error) {
    console.error('❌ Error al obtener IDs de correos:', error);
    
    // Log adicional para diagnóstico
    if (error instanceof Error) {
      console.error('📄 Detalles del error:', {
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n')[0] // Solo primera línea del stack
      });
    }
    
    throw error;
  } finally {
    // Cerrar la conexión siempre
    if (connection) {
      try {
        console.log('🔐 Cerrando conexión IMAP...');
        await connection.end();
        console.log('✅ Conexión IMAP cerrada correctamente');
      } catch (closeError) {
        console.error('⚠️  Error al cerrar conexión IMAP:', closeError);
      }
    }
  }
}

/**
 * Estrategia optimizada para bandejas muy grandes
 */
async function fetchEmailIdsOptimized(connection: any, sinceDate?: Date): Promise<string[]> {
  // Si tenemos fecha de referencia, no necesitamos estrategia compleja
  if (sinceDate) {
    console.log(`📅 Bandeja grande: buscando correos desde ${sinceDate.toISOString()}...`);
    const searchCriteria = [['SINCE', sinceDate]];
    const fetchOptions = { bodies: [], struct: false, envelope: false };
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`📊 Encontrados ${messages.length} correos recientes`);
    return messages.map((msg: Message) => String(msg.attributes.uid));
  }
  console.log('📈 Ejecutando estrategia optimizada para bandeja grande...');
  
  try {
    // Obtener solo los correos de los últimos 30 días para empezar
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const searchCriteria = ['SINCE', thirtyDaysAgo];
    const fetchOptions = {
      bodies: [],
      struct: false,
      envelope: false
    };
    
    console.log(`🗓️  Buscando correos desde ${thirtyDaysAgo.toISOString()}...`);
    const recentMessages = await connection.search(searchCriteria, fetchOptions);
    
    console.log(`📊 Encontrados ${recentMessages.length} correos recientes`);
    
    // Si hay pocos correos recientes, obtener más
    if (recentMessages.length < 100) {
      console.log('📅 Ampliando búsqueda a últimos 90 días...');
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const extendedCriteria = ['SINCE', ninetyDaysAgo];
      const extendedMessages = await connection.search(extendedCriteria, fetchOptions);
      
      console.log(`📊 Encontrados ${extendedMessages.length} correos en 90 días`);
      return extendedMessages.map((msg: Message) => String(msg.attributes.uid));
    }
    
    return recentMessages.map((msg: Message) => String(msg.attributes.uid));
  } catch (error) {
    console.error('❌ Error en estrategia optimizada:', error);
    
    // Fallback: obtener todos pero con timeout mayor
    console.log('🔄 Fallback: intentando obtener todos los correos...');
    const messages = await connection.search(['ALL'], { bodies: [], struct: false });
    return messages.map((msg: Message) => String(msg.attributes.uid));
  }
}


/**
 * Obtiene información detallada de correos por sus IDs (incluyendo cuerpo completo)
 */
/**
 * Obtiene información detallada de correos por sus IDs (incluyendo cuerpo completo)
 * VERSIÓN OPTIMIZADA - No carga todos los correos en memoria
 */
export async function fetchDetailedEmails(emailIds: string[]): Promise<DetailedEmail[]> {
  if (emailIds.length === 0) return [];
  
  console.log(`Obteniendo contenido detallado para ${emailIds.length} correos`);
  
  // Crear conexión IMAP con timeouts extendidos
  const imapConfig = {
    imap: {
      ...getImapConfig(),
      authTimeout: 60000,
      connTimeout: 60000
    }
  };
  
  let connection;
  try {
    connection = await ImapClient.connect(imapConfig);
    await connection.openBox('INBOX');
  } catch (connError) {
    console.error('Error al conectar con el servidor IMAP:', connError);
    return emailIds.map(id => ({ emailId: id }));
  }
  
  // Preparar resultados
  const detailedEmails: DetailedEmail[] = [];
  
  try {
    // Procesar cada correo individualmente para minimizar memoria
    for (const emailId of emailIds) {
      try {
        console.log(`Procesando correo individual: ${emailId}`);
        
        // ✅ OPTIMIZACIÓN: Buscar solo el correo específico por UID
        const searchCriteria = [['UID', emailId]];
        const fetchOptions = {
          bodies: ['HEADER', ''], // Obtener tanto encabezado como cuerpo completo
          struct: true
        };
        
        // Obtener solo este mensaje específico
        const messages = await connection.search(searchCriteria, fetchOptions);
        
        if (!messages || messages.length === 0) {
          console.log(`UID ${emailId} no existe (correo eliminado o movido). Se ignora.`);
          // No agregamos este correo, así no se intentará guardar
          continue;
        }
        
        const message = messages[0]; // Solo hay uno porque buscamos por UID específico
        
        // Obtener la parte del encabezado
        const headerPart = message.parts.find((part: any) => part.which === 'HEADER');
        if (!headerPart) {
          console.log(`No se pudo obtener el encabezado del correo ${emailId}`);
          detailedEmails.push({ emailId });
          continue;
        }
        
        // Obtener la parte que contiene el cuerpo completo
        const fullPart = message.parts.find((part: any) => part.which === '');
        if (!fullPart) {
          console.log(`No se pudo obtener el cuerpo del correo ${emailId}`);
          detailedEmails.push({ emailId });
          continue;
        }
        
        // Parsear encabezados con manejo de errores
        interface ParsedHeader {
          from?: string[];
          to?: string[];
          subject?: string[];
          date?: string[];
          [key: string]: string[] | undefined;
        }
        
        let parsedHeader: ParsedHeader = {};
        try {
          const headerBody = typeof headerPart.body === 'string' 
            ? headerPart.body 
            : JSON.stringify(headerPart.body);
          
          parsedHeader = parseHeader(headerBody);
        } catch (headerError) {
          console.error(`Error al parsear encabezado del correo ${emailId}:`, headerError);
          parsedHeader = {};
        }
        
        try {
          // Parsear el correo completo
          const parsed = await simpleParser(fullPart.body);
          
          // Extraer información segura del correo
          const getEmailAddress = (addressObj: any): string => {
            if (!addressObj) return '';
            
            try {
              if (typeof addressObj === 'string') return addressObj;
              if (addressObj.text) return addressObj.text;
              if (addressObj.address) return addressObj.address;
              
              if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value.length > 0) {
                return addressObj.value[0].address || '';
              }
              
              if (Array.isArray(addressObj) && addressObj.length > 0) {
                const first = addressObj[0];
                return typeof first === 'string' ? first : 
                       first.address || first.text || '';
              }
              
              return String(addressObj);
            } catch (e) {
              return '';
            }
          };
          
          // Extraer direcciones
          const fromAddress = getEmailAddress(parsed.from);
          const toAddress = getEmailAddress(parsed.to);
          
          // Extraer asunto
          const subject = parsed.subject || parsedHeader.subject?.[0] || '(Sin asunto)';
          
          // Extraer fecha de recepción
          let receivedDate = '';
          try {
            if (parsed.date) {
              receivedDate = parsed.date.toISOString();
            } else if (parsedHeader.date && parsedHeader.date[0]) {
              receivedDate = new Date(parsedHeader.date[0]).toISOString();
            } else {
              receivedDate = new Date().toISOString();
            }
          } catch (error) {
            receivedDate = new Date().toISOString();
          }
          
          // Obtener texto plano
          let textContent = '';
          if (typeof parsed.text === 'string') {
            textContent = parsed.text.trim();
            textContent = textContent.replace(/--+[a-zA-Z0-9]+(--)?\r?\n/g, '');
            textContent = textContent.replace(/Content-Type:[^\n]+\r?\n/g, '');
            textContent = textContent.replace(/Content-Transfer-Encoding:[^\n]+\r?\n/g, '');
          }
          
          // Obtener HTML si está disponible
          let htmlContent = '';
          if (typeof parsed.html === 'string' && parsed.html.trim()) {
            htmlContent = parsed.html;
          } else if (parsed.textAsHtml && typeof parsed.textAsHtml === 'string') {
            htmlContent = parsed.textAsHtml;
          }
          
          // Generar texto plano a partir del HTML como último recurso
          if (!textContent && htmlContent) {
            textContent = stripHtml(htmlContent);
          }

          // Si aún está vacío, marcarlo explícitamente
          if (!textContent) {
            textContent = '(Sin cuerpo: sólo adjuntos o invitación de calendario)';
          }
          
          const fullContent = textContent;
          const preview = textContent.substring(0, 150) + (textContent.length > 150 ? '...' : '');
          
          // Extraer adjuntos si existen
          let attachments;
          if (parsed.attachments && Array.isArray(parsed.attachments)) {
            attachments = parsed.attachments
              .filter(att => att && typeof att === 'object')
              .map(att => ({
                filename: att.filename || 'adjunto.bin',
                contentType: att.contentType || 'application/octet-stream',
                size: typeof att.size === 'number' ? att.size : 0
              }));
          }
          
          // Limitar el tamaño del contenido para evitar problemas de memoria
          let optimizedContent = fullContent;
          if (fullContent && fullContent.length > 50000) {
            console.log(`Correo ${emailId} tiene contenido grande (${fullContent.length} caracteres), recortando a 50K...`);
            optimizedContent = fullContent.substring(0, 50000) + "... (contenido truncado para ahorro de memoria)";
          }
          
          // Agregar correo detallado
          detailedEmails.push({
            emailId,
            from: cleanEmailString(fromAddress),
            to: cleanEmailString(toAddress),
            subject: cleanEmailString(subject),
            receivedDate,
            preview,
            fullContent: optimizedContent,
            attachments
          });
          
          console.log(`✅ Procesado correo ${emailId} - ${subject.substring(0, 30)}... - ${fullContent.length} chars`);
          
        } catch (error) {
          console.error(`Error al procesar correo ${emailId}:`, error);
          
          // Fallback con información básica del encabezado
          const fallbackFrom = parsedHeader.from?.[0] || '';
          const fallbackTo = parsedHeader.to?.[0] || '';
          const fallbackSubject = parsedHeader.subject?.[0] || '(Sin asunto)';
          
          let fallbackDate = '';
          try {
            if (parsedHeader.date && parsedHeader.date[0]) {
              fallbackDate = new Date(parsedHeader.date[0]).toISOString();
            } else {
              fallbackDate = new Date().toISOString();
            }
          } catch (dateError) {
            fallbackDate = new Date().toISOString();
          }
          
          detailedEmails.push({
            emailId,
            from: cleanEmailString(fallbackFrom),
            to: cleanEmailString(fallbackTo),
            subject: cleanEmailString(fallbackSubject),
            receivedDate: fallbackDate,
            preview: 'Error al procesar el contenido del correo'
          });
        }
        
        // Pequeña pausa entre correos para no sobrecargar
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (emailError) {
        console.error(`Error al procesar correo individual ${emailId}:`, emailError);
        detailedEmails.push({ emailId });
      }
    }
  } finally {
    // Cerrar conexión siempre
    try {
      await connection.end();
      console.log('Conexión IMAP cerrada correctamente');
    } catch (closeError) {
      console.error('Error al cerrar conexión IMAP:', closeError);
    }
  }
  
  return detailedEmails;
}

/**
 * Obtiene el contenido completo de un correo específico
 * Esta función se puede usar para cargar el contenido completo de correos individuales
 * cuando sea necesario, por ejemplo, al abrir un correo en la interfaz de usuario.
 */
export async function fetchEmailContent(emailId: string): Promise<DetailedEmail | null> {
  console.log(`Obteniendo contenido completo para el correo ${emailId}`);
  
  const imapConfig = {
    imap: getImapConfig()
  };
  
  let connection;
  try {
    connection = await ImapClient.connect(imapConfig);
    await connection.openBox('INBOX');
    
    // Buscar el mensaje específico por UID
    const searchCriteria = [['UID', emailId]];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      struct: true
    };
    
    const messages = await connection.search(searchCriteria, fetchOptions);
    
    if (!messages || messages.length === 0) {
      console.log(`No se encontró el correo con ID ${emailId}`);
      return null;
    }
    
    const message = messages[0];
    
    // Obtener la parte del encabezado
    const headerPart = message.parts.find((part: any) => part.which === 'HEADER');
    if (!headerPart) {
      console.log(`No se pudo obtener el encabezado del correo ${emailId}`);
      return null;
    }
    
    // Parsear el encabezado
    let parsedHeader: Record<string, string[]> = {};
    try {
      const headerBody = typeof headerPart.body === 'string' 
        ? headerPart.body 
        : JSON.stringify(headerPart.body);
      parsedHeader = parseHeader(headerBody);
    } catch (headerError) {
      console.error(`Error al parsear encabezado del correo ${emailId}:`, headerError);
    }
    
    // Obtener el cuerpo completo
    const fullPart = message.parts.find((part: any) => part.which === '');
    if (!fullPart) {
      console.log(`No se pudo obtener el cuerpo del correo ${emailId}`);
      return null;
    }
    
    // Parsear el correo completo
    const parsed = await simpleParser(fullPart.body);
    
    // Función auxiliar para extraer emails seguros
    const getEmailAddress = (addressObj: any): string => {
      if (!addressObj) return '';
      try {
        if (typeof addressObj === 'string') return addressObj;
        if (addressObj.text) return addressObj.text;
        if (addressObj.address) return addressObj.address;
        if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value.length > 0) {
          return addressObj.value[0].address || '';
        }
        if (Array.isArray(addressObj) && addressObj.length > 0) {
          const first = addressObj[0];
          return typeof first === 'string' ? first : first.address || first.text || '';
        }
        return String(addressObj);
      } catch (_) {
        return '';
      }
    };
    
    const fromAddress = getEmailAddress(parsed.from);
    const toAddress = getEmailAddress(parsed.to);
    
    let textContent = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!textContent && typeof parsed.html === 'string') {
      textContent = stripHtml(parsed.html);
    }
    
    const preview = textContent.substring(0, 150) + (textContent.length > 150 ? '...' : '');
    
    const attachments = parsed.attachments?.map(att => ({
      filename: att.filename || 'adjunto.bin',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0
    }));
    
    let subject = parsed.subject || '(Sin asunto)';
    
    let receivedDate = '';
    try {
      if (parsed.date) {
        receivedDate = parsed.date.toISOString();
      } else if (parsedHeader.date && parsedHeader.date[0]) {
        receivedDate = new Date(parsedHeader.date[0]).toISOString();
      } else {
        receivedDate = new Date().toISOString();
      }
    } catch (_) {
      receivedDate = new Date().toISOString();
    }
    
    await connection.end();
    
    return {
      emailId,
      from: fromAddress,
      to: toAddress,
      subject: cleanEmailString(subject),
      receivedDate,
      preview,
      fullContent: textContent,
      attachments
    };
  } catch (error) {
    console.error(`Error al obtener contenido del correo ${emailId}:`, error);
    return null;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (err) {
        console.error('Error al cerrar conexión IMAP:', err);
      }
    }
  }
}