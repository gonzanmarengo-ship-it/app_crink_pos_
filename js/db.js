// js/db.js - Database configuration using Dexie.js

// Declare Database
const db = new Dexie('CrinkPOSDb');

// Define Schema
db.version(2).stores({
    evento: '++id, nombre, estado, fecha_inicio', // estado: 'activo' o 'finalizado'
    costo_extra: '++id, evento_id, fecha',
    producto: '++id, nombre, categoria, activo',
    configuracion: 'id', // Siempre habrá un solo registro con id = 1
    pedido: '++id, evento_id, fecha_hora, estado',
    detalle_pedido: '++id, pedido_id, producto_id'
});

db.version(3).stores({
    evento: '++id, nombre, estado, fecha_inicio',
    costo_extra: '++id, evento_id, fecha',
    producto: '++id, nombre, categoria, activo',
    configuracion: 'id',
    pedido: '++id, evento_id, fecha_hora, estado',
    detalle_pedido: '++id, pedido_id, producto_id, bebida_elegida',
    bebida: '++id, nombre'
});

db.version(4).stores({
    evento: '++id, nombre, estado, fecha_inicio',
    costo_extra: '++id, evento_id, fecha',
    producto: '++id, nombre, categoria, activo',
    configuracion: 'id',
    pedido: '++id, evento_id, fecha_hora, estado',
    detalle_pedido: '++id, pedido_id, producto_id, bebida_elegida',
    bebida: '++id, nombre'
});

db.version(5).stores({
    evento: '++id, nombre, estado, fecha_inicio',
    costo_extra: '++id, evento_id, fecha',
    producto: '++id, nombre, categoria, activo',
    configuracion: 'id',
    pedido: '++id, evento_id, fecha_hora, estado',
    detalle_pedido: '++id, pedido_id, producto_id, bebida_elegida',
    bebida: '++id, nombre'
}).upgrade(tx => {
    // Schema upgrade if needed
});

// Initialize Settings and Default Products if DB is empty
async function initDb() {
    const configCount = await db.configuracion.count();
    if (configCount === 0) {
        await db.configuracion.add({
            id: 1,
            porcentaje_comision_posnet: 10.0,
            nombre_negocio: 'Food Truck',
            moneda: 'ARS'
        });
        
        console.log('Configuración por defecto inicializada.');
        
        // Add some default products
        await db.producto.bulkAdd([
            { nombre: 'Papas Chicas', categoria: 'Papas', precio_venta: 3000, costo_unitario: 1000, gramaje_papa: 150, activo: 1, opciones_bebida: "", cantidad_bebidas: 0 },
            { nombre: 'Papas Medianas', categoria: 'Papas', precio_venta: 4500, costo_unitario: 1500, gramaje_papa: 250, activo: 1, opciones_bebida: "", cantidad_bebidas: 0 },
            { nombre: 'Papas Grandes', categoria: 'Papas', precio_venta: 6000, costo_unitario: 2000, gramaje_papa: 400, activo: 1, opciones_bebida: "", cantidad_bebidas: 0 },
            { nombre: 'Cerveza Lata', categoria: 'Bebidas', precio_venta: 3000, costo_unitario: 1200, gramaje_papa: 0, activo: 1, opciones_bebida: "Rubia, Roja, IPA, Negra", cantidad_bebidas: 1 },
            { nombre: 'Gaseosa', categoria: 'Bebidas', precio_venta: 2000, costo_unitario: 800, gramaje_papa: 0, activo: 1, opciones_bebida: "Coca, Coca Zero, Fanta, Sprite, Agua", cantidad_bebidas: 1 }
        ]);
        console.log('Productos por defecto inicializados.');
        
        // Add default drinks
        await db.bebida.bulkAdd([
            { nombre: 'Coca' },
            { nombre: 'Coca Zero' },
            { nombre: 'Fanta' },
            { nombre: 'Sprite' },
            { nombre: 'Agua' },
            { nombre: 'Rubia' },
            { nombre: 'Roja' },
            { nombre: 'IPA' },
            { nombre: 'Negra' }
        ]);
    }
}

// Helper to get active event
async function getActiveEvent() {
    const events = await db.evento.where('estado').equals('activo').toArray();
    return events.length > 0 ? events[0] : null;
}

// Helper to check config
async function getConfig() {
    return await db.configuracion.get(1);
}
