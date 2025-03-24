import { EmailStatus } from '../types';

/**
 * Limpia una cadena de texto de caracteres especiales usados en correos
 */
export function cleanEmailString(emailString: string): string {
  if (!emailString) return '';
  
  return emailString
    .replace(/\\"/g, '"')   // Reemplazar \" por "
    .replace(/\\'/g, "'")   // Reemplazar \' por '
    .replace(/\\n/g, '\n')  // Reemplazar \n por salto de línea real
    .replace(/\\t/g, '\t')  // Reemplazar \t por tabulación real
    .replace(/\\\\r/g, '\r'); // Reemplazar \\r por retorno de carro real
}

/**
 * Mapea un estado a su formato en Strapi
 */
export function mapToStrapiStatus(status: string): string {
  switch (status) {
    case "necesitaAtencion":
      return "necesitaAtencion";
    case "respondido":
      return "respondido";
    case "informativo":
      return "informativo";
    default:
      return "necesitaAtencion";
  }
}

/**
 * Mapea un estado de Strapi a su formato en la aplicación
 */
export function mapFromStrapiStatus(status: string): EmailStatus {
  if (!status) return "necesitaAtencion";
  
  switch (status) {
    case "necesitaAtencion":
      return "necesitaAtencion";
    case "respondido":
      return "respondido";
    case "informativo":
      return "informativo";
    default:
      return "necesitaAtencion";
  }
}

/**
 * Escapa texto para consultas GraphQL
 */
export function escapeForGraphQL(text: string): string {
  if (!text) return "";
  
  // Limitar la longitud del texto para evitar problemas con textos muy largos
  const maxLength = 25000;
  let truncatedText = text;
  if (text.length > maxLength) {
    truncatedText = text.substring(0, maxLength) + "...";
  }
  
  // Escapar comillas dobles, barras invertidas y caracteres de nueva línea
  return truncatedText
    .replace(/\\/g, '\\\\') // Escapar barras invertidas primero
    .replace(/"/g, '\\"')   // Escapar comillas dobles
    .replace(/\n/g, '\\n')  // Convertir saltos de línea
    .replace(/\r/g, '')     // Eliminar retornos de carro
    .replace(/\t/g, ' ')    // Convertir tabulaciones en espacios
    .replace(/\f/g, '')     // Eliminar form feeds
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Eliminar caracteres de control
}

/**
 * Elimina etiquetas HTML manteniendo el formato de texto básico
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  
  // Reemplazar etiquetas HTML básicas con equivalentes de texto plano
  const textWithLineBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '') 
    .replace(/<\/p>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<tr[^>]*>/gi, '')
    .replace(/<\/tr>\s*<tr[^>]*>/gi, '\n')
    .replace(/<td[^>]*>/gi, '')
    .replace(/<\/td>\s*<td[^>]*>/gi, ', ')
    .replace(/<\/td>/gi, ' ');
  
  // Eliminar todas las etiquetas HTML restantes
  const textWithoutTags = textWithLineBreaks.replace(/<[^>]*>/g, '');
  
  // Decodificar entidades HTML
  const decodedText = textWithoutTags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
  
  // Normalizar espacios
  return decodedText
    .replace(/\n{3,}/g, '\n\n') // Reducir múltiples líneas vacías a máximo 2
    .replace(/\s+\n/g, '\n')    // Eliminar espacios antes de saltos de línea
    .replace(/\n\s+/g, '\n')    // Eliminar espacios después de saltos de línea
    .replace(/ {2,}/g, ' ')     // Reducir múltiples espacios a uno solo
    .trim();                    // Eliminar espacios al inicio y final
}

/**
 * Formatea una fecha para su visualización
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-ES', {
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
} 