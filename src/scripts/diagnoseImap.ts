#!/usr/bin/env node

/**
 * Script de diagnóstico completo para problemas IMAP
 * Útil para entender por qué las búsquedas están fallando
 * 
 * Uso: npm run diagnose-imap
 */

import { formatDate } from '../utils';
import { getImapConfig } from '../services/config';
import ImapClient from 'imap-simple';

async function diagnoseImapServer() {
  console.log(`🔍 Diagnóstico completo del servidor IMAP - ${formatDate(new Date())}`);
  
  const imapConfig = {
    imap: getImapConfig()
  };
  
  let connection: any = null;
  
  try {
    // Test 1: Conexión básica
    console.log('\n1️⃣ === PRUEBA DE CONEXIÓN ===');
    const connectStart = Date.now();
    
    connection = await Promise.race([
      ImapClient.connect(imapConfig),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout conexión')), 30000)
      )
    ]);
    
    const connectDuration = Date.now() - connectStart;
    console.log(`✅ Conexión exitosa en ${connectDuration}ms`);
    
    // Test 2: Información del servidor
    console.log('\n2️⃣ === INFORMACIÓN DEL SERVIDOR ===');
    try {
      const openStart = Date.now();
      const box = await Promise.race([
        connection.openBox('INBOX'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout abrir INBOX')), 20000)
        )
      ]);
      const openDuration = Date.now() - openStart;
      
      console.log(`✅ INBOX abierto en ${openDuration}ms`);
      console.log(`📊 Total de correos en servidor: ${box.messages.total}`);
      console.log(`📧 Correos nuevos: ${box.messages.new}`);
      console.log(`🔔 Correos recientes: ${box.messages.recent || 0}`);
      console.log(`📮 Correos no leídos: ${box.messages.unseen}`);
      console.log(`🔒 Permisos: ${box.permFlags.join(', ')}`);
      
      // Esto nos dice si el problema es la cantidad de correos
      if (box.messages.total > 50000) {
        console.log('⚠️  ALERTA: Servidor tiene más de 50,000 correos');
        console.log('💡 Esto explica por qué las búsquedas ALL fallan');
      } else if (box.messages.total > 10000) {
        console.log('⚠️  ADVERTENCIA: Servidor tiene más de 10,000 correos');
        console.log('💡 Las búsquedas pueden ser lentas');
      }
      
    } catch (boxError) {
      console.log('❌ Error obteniendo información del servidor:', boxError);
    }
    
    // Test 3: Velocidad de búsquedas simples
    console.log('\n3️⃣ === PRUEBAS DE VELOCIDAD ===');
    
    // Test RECENT (más rápido)
    try {
      console.log('🔍 Probando búsqueda RECENT...');
      const recentStart = Date.now();
      
      const recentResults = await Promise.race([
        connection.search(['RECENT'], { bodies: '', struct: false }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout RECENT')), 30000)
        )
      ]);
      
      const recentDuration = Date.now() - recentStart;
      console.log(`✅ RECENT: ${recentResults.length} correos en ${recentDuration}ms`);
      
    } catch (recentError) {
      console.log('❌ Búsqueda RECENT falló:', recentError);
    }
    
    // Test rango de números (más controlado)
    try {
      console.log('🔍 Probando búsqueda por rango (últimos 10)...');
      const rangeStart = Date.now();
      
      const rangeResults = await Promise.race([
        connection.search(['*:10'], { bodies: '', struct: false }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout rango')), 30000)
        )
      ]);
      
      const rangeDuration = Date.now() - rangeStart;
      console.log(`✅ Rango *:10: ${rangeResults.length} correos en ${rangeDuration}ms`);
      
    } catch (rangeError) {
      console.log('❌ Búsqueda por rango falló:', rangeError);
    }
    
    // Test ALL con timeout corto para ver si es factible
    console.log('🔍 Probando búsqueda ALL con timeout de 30 segundos...');
    try {
      const allStart = Date.now();
      
      const allResults = await Promise.race([
        connection.search(['ALL'], { bodies: '', struct: false }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ALL (30s)')), 30000)
        )
      ]);
      
      const allDuration = Date.now() - allStart;
      console.log(`✅ ALL: ${allResults.length} correos en ${allDuration}ms`);
      
      if (allDuration > 10000) {
        console.log('⚠️  ADVERTENCIA: Búsqueda ALL muy lenta (>10s)');
        console.log('💡 Recomendación: Usar solo búsquedas conservadoras');
      }
      
    } catch (allError) {
      console.log('❌ Búsqueda ALL falló en 30s:', allError);
      console.log('💡 CONCLUSIÓN: Servidor demasiado lento para búsquedas completas');
    }
    
    // Test 4: Recomendaciones
    console.log('\n4️⃣ === DIAGNÓSTICO Y RECOMENDACIONES ===');
    
    console.log('📊 RESUMEN DEL DIAGNÓSTICO:');
    console.log(`⏱️  Tiempo de conexión: ${connectDuration}ms`);
    console.log('🔍 Búsquedas que funcionan: RECENT, rangos pequeños');
    console.log('🚫 Búsquedas que fallan: ALL (timeout)');
    
    console.log('\n💡 RECOMENDACIONES:');
    console.log('1. Usar solo búsqueda conservadora para este servidor');
    console.log('2. Configurar sincronización más frecuente (cada 5 minutos)');
    console.log('3. Considerar limpieza del servidor IMAP si es posible');
    
    console.log('\n🔧 COMANDOS RECOMENDADOS:');
    console.log('curl http://localhost:3030/api/imap/test-conservative-search');
    console.log('curl -X POST http://localhost:3030/api/sync/reset');
    
  } catch (error) {
    console.error('❌ Error durante diagnóstico:', error);
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.end();
        console.log('\n🔌 Conexión cerrada');
      } catch (closeError) {
        console.error('⚠️  Error al cerrar conexión:', closeError);
      }
    }
  }
}

// Ejecutar diagnóstico
diagnoseImapServer()
  .then(() => {
    console.log('\n✅ Diagnóstico IMAP completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error durante diagnóstico IMAP:', error);
    process.exit(1);
  }); 