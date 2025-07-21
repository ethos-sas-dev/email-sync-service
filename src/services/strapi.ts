import axios from 'axios';
import { DetailedEmail, EmailMetadata, EmailStatus } from '../types';
import { getStrapiConfig } from './config';
import { escapeForGraphQL, mapToStrapiStatus } from '../utils';

/**
 * Obtiene todos los correos electrónicos desde Strapi
 */
export async function getEmailsFromStrapi(): Promise<EmailMetadata[]> {
  console.log('Obteniendo correos desde Strapi...');
  
  const { graphqlUrl, apiToken } = getStrapiConfig();
  
  if (!graphqlUrl || !apiToken) {
    console.error('Error: URL de GraphQL o token de Strapi no están configurados');
    return [];
  }
  const pageSize = 1000;
  let start = 0;
  const emails: EmailMetadata[] = [];

  try {
    while (true) {
      // Construimos la consulta con paginación manual
      const query = `
        query {
          emailTrackings(pagination: { start: ${start}, limit: ${pageSize} }) {
            documentId
            emailId
            emailStatus
            from
            to
            subject
            receivedDate
            lastResponseBy
            fullContent
          }
        }
      `;

      const response = await axios.post(
        graphqlUrl,
        { query },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiToken}`
          }
        }
      );

      if (response.data.errors) {
        console.error('Error en la respuesta de GraphQL:', response.data.errors);
        break;
      }

      const batch = response.data.data?.emailTrackings;
      if (!Array.isArray(batch) || batch.length === 0) {
        // No quedan más registros que procesar
        break;
      }

      // Mapear y añadir al arreglo total
      batch.forEach((track: any) => {
        let preview = "";
        if (track.fullContent) {
          preview = track.fullContent.substring(0, 100) + (track.fullContent.length > 100 ? "..." : "");
        }

        emails.push({
          id: track.documentId,
          emailId: track.emailId,
          from: track.from || '',
          to: track.to || '',
          subject: track.subject || '',
          receivedDate: track.receivedDate || new Date().toISOString(),
          status: track.emailStatus as EmailStatus || 'necesitaAtencion',
          lastResponseBy: track.lastResponseBy,
          preview,
          fullContent: track.fullContent
        });
      });

      // Avanzar a la siguiente página
      start += pageSize;
    }

    console.log(`Obtenidos ${emails.length} correos desde Strapi (paginado)`);
    return emails;
  } catch (error) {
    console.error('Error al obtener correos desde Strapi (paginado):', error);
    return emails;
  }
}

/**
 * Sincroniza un correo con Strapi
 */
export async function syncEmailWithStrapi(
  email: DetailedEmail,
  status: EmailStatus = 'necesitaAtencion'
): Promise<string | null> {
  if (!email.emailId) {
    console.error('Error: ID de correo no proporcionado');
    return null;
  }
  
  try {
    const baseUrl = process.env.STRAPI_REST_URL || process.env.GRAPHQL_URL?.replace('/graphql','');
    const { apiToken } = getStrapiConfig();
    if (!baseUrl || !apiToken) {
      console.error('Error: URL de Strapi o token no configurados');
      return null;
    }
    // 1) Verificar si existe por REST
    const checkUrl = `${baseUrl}/api/email-trackings?filters[emailId][$eq]=${encodeURIComponent(String(email.emailId))}`;
    const checkResponse = await axios.get(checkUrl, {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
    const found = Array.isArray(checkResponse.data?.data) && checkResponse.data.data.length > 0;
     
    if (found) {
      const existing = checkResponse.data.data[0];
      const existingId = existing.documentId || existing.id;
      // Si el contenido es nulo o placeholder, actualizamos
      const existingContent = existing.attributes?.fullContent || '';
      const needsUpdate = !existingContent || existingContent.startsWith('(Contenido no disponible') || existingContent.startsWith('Error al procesar');
 
      if (!needsUpdate) {
        // Ya está completo; no hacer nada
        return existingId;
      }
 
      // Limitar tamaño del contenido (10k)
      let updateContent = email.fullContent || email.preview || '(Contenido no disponible)';
      if (typeof updateContent === 'string' && updateContent.length > 10000) {
        updateContent = updateContent.substring(0, 10000) + '... (contenido truncado)';
      }

      const updateUrl = `${baseUrl}/api/email-trackings/${existingId}`;
      await axios.put(updateUrl, {
        data: {
          from: email.from || '',
          to: email.to || '',
          subject: email.subject || '',
          receivedDate: email.receivedDate || new Date().toISOString(),
          fullContent: updateContent,
          emailStatus: mapToStrapiStatus(status),
          lastResponseBy: null
        }
      }, { headers: { Authorization: `Bearer ${apiToken}` } });

      console.log(`Correo ${email.emailId} actualizado con contenido completo`);
      return existingId;
    }
    
    // El correo no existe, crear uno nuevo
    const strapiStatus = mapToStrapiStatus(status);
    
    const createUrl = `${baseUrl}/api/email-trackings`;

    // Limitar contenido
    let content = email.fullContent || email.preview || '(Contenido no disponible)';
    if (typeof content === 'string' && content.length > 10000) {
      content = content.substring(0, 10000) + '... (contenido truncado)';
    }

    const payload = {
      emailId: String(email.emailId),
      from: email.from || '',
      to: email.to || '',
      subject: email.subject || '',
      receivedDate: email.receivedDate || new Date().toISOString(),
      emailStatus: strapiStatus,
      fullContent: content,
      lastResponseBy: null
    };

    console.log(`Guardando correo ${email.emailId} - contenido ${content.length} chars`);

    const createResp = await axios.post(createUrl, { data: payload }, { headers: { Authorization: `Bearer ${apiToken}` } });

    const newId = createResp.data?.data?.documentId || createResp.data?.data?.id;
    
    if (newId) {
      console.log(`Correo ${email.emailId} creado en Strapi con ID: ${newId}`);
      return newId;
    } else {
      console.error(`No se pudo obtener el ID del correo creado para ${email.emailId}`);
      return null;
    }
  } catch (error) {
    console.error('Error al sincronizar correo con Strapi:', error);
    return null;
  }
}

/**
 * Actualiza el estado de un correo en Strapi
 */
export async function updateEmailStatus(
  emailId: string, 
  status: EmailStatus, 
  lastResponseBy?: string
): Promise<boolean> {
  try {
    const { graphqlUrl, apiToken } = getStrapiConfig();
    
    if (!graphqlUrl || !apiToken) {
      console.error('Error: URL de GraphQL o token de Strapi no están configurados');
      return false;
    }
    
    // Buscar el correo por ID
    const findQuery = `
      query {
        emailTrackings(filters: { emailId: { eq: "${emailId}" } }) {
          documentId
          emailId
          emailStatus
        }
      }
    `;
    
    const findResponse = await axios.post(
      graphqlUrl,
      { query: findQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        }
      }
    );
    
    if (findResponse.data.errors) {
      console.error('Error al buscar correo en Strapi:', findResponse.data.errors);
      return false;
    }
    
    const emailData = findResponse.data.data?.emailTrackings?.[0];
    if (!emailData) {
      console.error(`No se encontró el correo con ID ${emailId} en Strapi`);
      return false;
    }
    
    // Actualizar el estado del correo
    const updateMutation = `
      mutation UpdateEmail($id: ID!, $data: EmailTrackingInput!) {
        updateEmailTracking(
          id: $id
          data: $data
        ) {
          documentId
          emailId
          emailStatus
        }
      }
    `;
    
    const updateVariables = {
      id: emailData.documentId,
      data: {
        emailStatus: mapToStrapiStatus(status),
        lastResponseBy: lastResponseBy || null
      }
    };
    
    const updateResponse = await axios.post(
      graphqlUrl,
      { 
        query: updateMutation,
        variables: updateVariables
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        }
      }
    );
    
    if (updateResponse.data.errors) {
      console.error('Error al actualizar correo en Strapi:', updateResponse.data.errors);
      return false;
    }
    
    console.log(`Correo ${emailId} actualizado en Strapi con estado: ${status}`);
    return true;
  } catch (error) {
    console.error('Error al actualizar estado del correo en Strapi:', error);
    return false;
  }
} 