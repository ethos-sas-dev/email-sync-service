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
  
  const query = `
    query {
      emailTrackings(pagination: { limit: 1000 }) {
        documentId
        emailId
        emailStatus
        from
        to
        subject
        receivedDate
        lastResponseBy
        fullContent
        publishedAt
      }
    }
  `;
  
  try {
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
      return [];
    }
    
    if (!response.data.data?.emailTrackings) {
      console.error('Estructura de datos inesperada en la respuesta de Strapi');
      return [];
    }
    
    // Mapear los emails desde el formato de Strapi
    const emails: EmailMetadata[] = response.data.data.emailTrackings.map((track: any) => {
      // Generar una vista previa del contenido si está disponible
      let preview = "";
      if (track.fullContent) {
        preview = track.fullContent.substring(0, 100) + (track.fullContent.length > 100 ? "..." : "");
      }
      
      return {
        id: track.documentId,
        emailId: track.emailId,
        from: track.from || '',
        to: track.to || '',
        subject: track.subject || '',
        receivedDate: track.receivedDate || new Date().toISOString(),
        status: track.emailStatus as EmailStatus || 'necesitaAtencion',
        lastResponseBy: track.lastResponseBy,
        preview: preview,
        fullContent: track.fullContent
      };
    });
    
    console.log(`Obtenidos ${emails.length} correos desde Strapi`);
    return emails;
  } catch (error) {
    console.error('Error al obtener correos desde Strapi:', error);
    return [];
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
    const { graphqlUrl, apiToken } = getStrapiConfig();
    
    if (!graphqlUrl || !apiToken) {
      console.error('Error: URL de GraphQL o token de Strapi no están configurados');
      return null;
    }
    
    // Verificar si el correo ya existe
    const checkQuery = `
      query {
        emailTrackings(filters: { emailId: { eq: "${String(email.emailId)}" } }) {
          documentId
          emailId
          emailStatus
          lastResponseBy
        }
      }
    `;
    
    const checkResponse = await axios.post(
      graphqlUrl,
      { query: checkQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        }
      }
    );
    
    if (checkResponse.data.errors) {
      console.error('Error al verificar correo en Strapi:', checkResponse.data.errors);
      return null;
    }
    
    const exists = checkResponse.data.data?.emailTrackings && 
                  checkResponse.data.data.emailTrackings.length > 0;
    
    if (exists) {
      // El correo ya existe, devolver su ID
      return checkResponse.data.data.emailTrackings[0].documentId;
    }
    
    // El correo no existe, crear uno nuevo
    const strapiStatus = mapToStrapiStatus(status);
    
    const createMutation = `
      mutation CreateEmail($data: EmailTrackingInput!) {
        createEmailTracking(
          data: $data
        ) {
          documentId
          emailId
          emailStatus
        }
      }
    `;
    
    const createVariables = {
      data: {
        emailId: String(email.emailId),
        from: escapeForGraphQL(email.from || ''),
        to: escapeForGraphQL(email.to || ''),
        subject: escapeForGraphQL(email.subject || ''),
        receivedDate: email.receivedDate || new Date().toISOString(),
        emailStatus: strapiStatus,
        // Limitar el tamaño del contenido para evitar problemas de memoria
        // Si el contenido es demasiado grande, lo recortamos a 50K caracteres para reducir consumo
        fullContent: escapeForGraphQL(
          typeof email.fullContent === 'string' && email.fullContent.trim() 
            ? email.fullContent.length > 50000 
              ? email.fullContent.trim().substring(0, 50000) + '... (contenido truncado para ahorrar memoria)'
              : email.fullContent.trim() 
            : email.preview || '(Contenido no disponible)'
        ),
        lastResponseBy: null
      }
    };
    
    // Log para depurar (mostrar si tenemos contenido)
    console.log(`Guardando correo ${email.emailId} - Longitud del contenido: ${(email.fullContent || '').length} caracteres`);
    
    const createResponse = await axios.post(
      graphqlUrl,
      { 
        query: createMutation,
        variables: createVariables
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`
        }
      }
    );
    
    if (createResponse.data.errors) {
      console.error('Error al crear correo en Strapi:', createResponse.data.errors);
      return null;
    }
    
    const newId = createResponse.data.data?.createEmailTracking?.documentId;
    
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