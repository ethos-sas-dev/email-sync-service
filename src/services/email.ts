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
export async function fetchEmailIds(): Promise<string[]> {
  console.log('Obteniendo IDs de correos desde el servidor IMAP...');
  
  const imapConfig = {
    imap: getImapConfig()
  };
  
  try {
    // Conectar al servidor IMAP
    const connection = await ImapClient.connect(imapConfig);
    console.log('Conexión establecida con el servidor IMAP');
    
    // Abrir bandeja de entrada
    await connection.openBox('INBOX');
    console.log('Bandeja INBOX abierta');
    
    // Obtener solo los IDs de todos los correos
    const searchCriteria = ['ALL'];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (DATE FROM SUBJECT MESSAGE-ID)'],
      struct: true
    };
    
    // Obtener los mensajes
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`Encontrados ${messages.length} correos en el servidor`);
    
    // Extraer solo los IDs
    const emailIds = messages.map((msg: Message) => String(msg.attributes.uid));
    
    // Cerrar la conexión
    await connection.end();
    console.log('Conexión con servidor IMAP cerrada');
    
    return emailIds;
  } catch (error) {
    console.error('Error al obtener IDs de correos:', error);
    throw error;
  }
}

/**
 * Obtiene información detallada de correos por sus IDs (incluyendo cuerpo completo)
 */
export async function fetchDetailedEmails(emailIds: string[]): Promise<DetailedEmail[]> {
  if (emailIds.length === 0) return [];
  
  console.log(`Obteniendo contenido detallado para ${emailIds.length} correos`);
  
  // Crear conexión IMAP
  const imapConfig = {
    imap: getImapConfig()
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
    // Procesar en lotes pequeños para no sobrecargar el servidor IMAP
    const batchSize = 3;
    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batchIds = emailIds.slice(i, i + batchSize);
      
      // Criterio de búsqueda para obtener todos los mensajes
      const searchCriteria = ['ALL'];
      const fetchOptions = {
        bodies: ['HEADER', ''], // Obtener tanto encabezado como cuerpo completo
        struct: true
      };
      
      // Obtener mensajes
      const messages = await connection.search(searchCriteria, fetchOptions);
      
      // Filtrar solo los mensajes que necesitamos
      for (const emailId of batchIds) {
        // Buscar el mensaje con este ID
        const message = messages.find((msg: Message) => String(msg.attributes.uid) === String(emailId));
        
        if (!message) {
          console.log(`No se encontró el correo con ID ${emailId}`);
          detailedEmails.push({ emailId });
          continue;
        }
        
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
        // Definir interfaz para los encabezados parseados
        interface ParsedHeader {
          from?: string[];
          to?: string[];
          subject?: string[];
          date?: string[];
          [key: string]: string[] | undefined;
        }
        
        let parsedHeader: ParsedHeader = {};
        try {
          // Asegurarnos que headerPart.body es un string antes de parsearlo
          const headerBody = typeof headerPart.body === 'string' 
            ? headerPart.body 
            : JSON.stringify(headerPart.body);
          
          // Usar nuestra propia función parseHeader
          parsedHeader = parseHeader(headerBody);
        } catch (headerError) {
          console.error(`Error al parsear encabezado del correo ${emailId}:`, headerError);
          // Continuar con un objeto vacío
          parsedHeader = {};
        }
        
        try {
          // Parsear el correo completo
          const parsed = await simpleParser(fullPart.body);
          
          // Extraer información segura del correo
          let fromAddress = '';
          let toAddress = '';
          
          // Usar una función auxiliar para extraer la dirección
          const getEmailAddress = (addressObj: any): string => {
            if (!addressObj) return '';
            
            try {
              // Intentar diferentes formatos de direcciones de correo
              if (typeof addressObj === 'string') return addressObj;
              
              // Si tiene texto, usarlo directamente
              if (addressObj.text) return addressObj.text;
              
              // Si tiene dirección, usarla
              if (addressObj.address) return addressObj.address;
              
              // Si tiene un array value, obtener la primera dirección
              if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value.length > 0) {
                return addressObj.value[0].address || '';
              }
              
              // Si es un array, tomar el primer elemento
              if (Array.isArray(addressObj) && addressObj.length > 0) {
                const first = addressObj[0];
                return typeof first === 'string' ? first : 
                       first.address || first.text || '';
              }
              
              // Último recurso: convertir a string
              return String(addressObj);
            } catch (e) {
              // Si hay error, devolver cadena vacía
              return '';
            }
          };
          
          // Extraer direcciones
          fromAddress = getEmailAddress(parsed.from);
          toAddress = getEmailAddress(parsed.to);
          
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
            
            // Limpiar marcas de límite multipart que puedan aparecer en el texto
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
          
          // Usar texto plano para almacenar
          const fullContent = textContent;
          
          // Generar vista previa
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
          
          // Agregar correo detallado con fecha
          detailedEmails.push({
            emailId,
            from: cleanEmailString(fromAddress),
            to: cleanEmailString(toAddress),
            subject: cleanEmailString(subject),
            receivedDate,
            preview,
            fullContent,
            attachments
          });
          
          // Log para confirmar que tenemos contenido
          console.log(`Procesado correo ${emailId} - Asunto: ${subject.substring(0, 30)}... - Contenido: ${fullContent ? fullContent.length : 0} caracteres`);
        } catch (error) {
          console.error(`Error al procesar correo ${emailId}:`, error);
          
          // Intentar crear un email con la información básica del encabezado
          const fallbackFrom = parsedHeader.from?.[0] || '';
          const fallbackTo = parsedHeader.to?.[0] || '';
          const fallbackSubject = parsedHeader.subject?.[0] || '(Sin asunto)';
          
          // Intentar obtener fecha o usar fecha actual
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
      // Asegurarnos que headerPart.body es un string antes de parsearlo
      const headerBody = typeof headerPart.body === 'string' 
        ? headerPart.body 
        : JSON.stringify(headerPart.body);
      
      // Usar nuestra propia función parseHeader
      parsedHeader = parseHeader(headerBody);
    } catch (headerError) {
      console.error(`Error al parsear encabezado del correo ${emailId}:`, headerError);
      // No es crítico, continuamos
    }
    
    // Obtener el cuerpo completo
    const fullPart = message.parts.find((part: any) => part.which === '');
    if (!fullPart) {
      console.log(`No se pudo obtener el cuerpo del correo ${emailId}`);
      return null;
    }
    
    // Parsear el correo completo
    const parsed = await simpleParser(fullPart.body);
    
    // Extraer información segura del correo usando la misma función auxiliar
    const getEmailAddress = (addressObj: any): string => {
      if (!addressObj) return '';
      
      try {
        // Intentar diferentes formatos de direcciones de correo
        if (typeof addressObj === 'string') return addressObj;
        
        // Si tiene texto, usarlo directamente
        if (addressObj.text) return addressObj.text;
        
        // Si tiene dirección, usarla
        if (addressObj.address) return addressObj.address;
        
        // Si tiene un array value, obtener la primera dirección
        if (addressObj.value && Array.isArray(addressObj.value) && addressObj.value.length > 0) {
          return addressObj.value[0].address || '';
        }
        
        // Si es un array, tomar el primer elemento
        if (Array.isArray(addressObj) && addressObj.length > 0) {
          const first = addressObj[0];
          return typeof first === 'string' ? first : 
                 first.address || first.text || '';
        }
        
        // Último recurso: convertir a string
        return String(addressObj);
      } catch (e) {
        // Si hay error, devolver cadena vacía
        return '';
      }
    };
    
    // Extraer direcciones
    const fromAddress = getEmailAddress(parsed.from);
    const toAddress = getEmailAddress(parsed.to);
    
    // Obtener texto plano
    let textContent = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    
    // Si no hay texto plano pero hay HTML, convertir HTML a texto
    if (!textContent && typeof parsed.html === 'string') {
      textContent = stripHtml(parsed.html);
    }
    
    // Crear la vista previa
    const preview = textContent.substring(0, 150) + (textContent.length > 150 ? '...' : '');
    
    // Extraer adjuntos
    const attachments = parsed.attachments?.map(att => ({
      filename: att.filename || 'adjunto.bin',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0
    }));
    
    // Extraer información segura del correo
    let subject = parsed.subject || '(Sin asunto)';
    
    // Obtener la fecha del correo
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
    
    // Cerrar la conexión
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