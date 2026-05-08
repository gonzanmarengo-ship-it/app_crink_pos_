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

// v6: agrega stock de papa y cierre de caja al evento.
// No cambian los índices (los nuevos campos no son indexables),
// pero bumpeamos versión para correr el upgrade que setea defaults
// a los eventos viejos. Sin esto, sus campos quedan undefined y
// los cálculos podrían tirar NaN.
db.version(6).stores({
    evento: '++id, nombre, estado, fecha_inicio',
    costo_extra: '++id, evento_id, fecha',
    producto: '++id, nombre, categoria, activo',
    configuracion: 'id',
    pedido: '++id, evento_id, fecha_hora, estado',
    detalle_pedido: '++id, pedido_id, producto_id, bebida_elegida',
    bebida: '++id, nombre'
}).upgrade(async tx => {
    await tx.table('evento').toCollection().modify(ev => {
        if (ev.stock_inicial_kg === undefined) ev.stock_inicial_kg = 0;
        if (ev.stock_repuesto_kg === undefined) ev.stock_repuesto_kg = 0;
        if (ev.efectivo_inicial === undefined) ev.efectivo_inicial = 0;
        if (ev.efectivo_final === undefined) ev.efectivo_final = null;
    });
});

// v7: agrega stock_bebida (inventario de bebidas por evento),
// nota y descuento en pedidos. También permite medio_pago = 'cortesia'.
db.version(7).stores({
    evento: '++id, nombre, estado, fecha_inicio',
    costo_extra: '++id, evento_id, fecha',
    producto: '++id, nombre, categoria, activo',
    configuracion: 'id',
    pedido: '++id, evento_id, fecha_hora, estado',
    detalle_pedido: '++id, pedido_id, producto_id, bebida_elegida',
    bebida: '++id, nombre',
    stock_bebida: '++id, evento_id'
}).upgrade(async tx => {
    // Pedidos viejos: defaults para nuevos campos
    await tx.table('pedido').toCollection().modify(p => {
        if (p.nota === undefined) p.nota = '';
        if (p.descuento === undefined) p.descuento = 0;
    });
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

// Conversión clave del negocio: 1 kg de papa cruda rinde 650 g cocidos (merma 35%).
const PAPA_RENDIMIENTO_GR_COCIDOS_POR_KG_CRUDO = 650;

// Suma todos los gramos cocidos vendidos en un evento (sale de los snapshots
// históricos de gramaje en cada detalle de pedido).
async function getGramosCocidosVendidos(eventoId) {
    const pedidos = await db.pedido.where('evento_id').equals(eventoId).toArray();
    if (pedidos.length === 0) return 0;
    const ids = pedidos.map(p => p.id);
    const detalles = await db.detalle_pedido.where('pedido_id').anyOf(ids).toArray();
    return detalles.reduce((acc, d) => acc + (d.gramaje_historico || 0) * d.cantidad, 0);
}

// Calcula el snapshot de stock del evento (todo en kg crudos).
// Devuelve { inicial, repuesto, total_cargado, consumido, restante }.
async function getStockEvento(eventoId) {
    const ev = await db.evento.get(eventoId);
    if (!ev) return null;

    const inicial = ev.stock_inicial_kg || 0;
    const repuesto = ev.stock_repuesto_kg || 0;
    const totalCargado = inicial + repuesto;

    const gramosCocidosVendidos = await getGramosCocidosVendidos(eventoId);
    // gramos cocidos → kg crudos: dividir por la constante (g_cocidos/kg_crudo).
    // La constante ya tiene unidades g/kg, así que el resultado es directo en kg crudos.
    // NO dividir por 1000 extra: eso haría el resultado 1000× demasiado chico.
    const consumido = gramosCocidosVendidos / PAPA_RENDIMIENTO_GR_COCIDOS_POR_KG_CRUDO;
    const restante = totalCargado - consumido;

    return { inicial, repuesto, totalCargado, consumido, restante };
}

// ── Stock de bebidas por evento ──────────────────────────────────
// Cada fila de stock_bebida tiene: evento_id, bebida_nombre,
// cantidad_inicial, cantidad_repuesta.
// Lo consumido se calcula dinámicamente parseando bebida_elegida
// de los detalles de pedido del evento.

// Cuenta cuántas unidades de cada bebida se vendieron en un evento.
// Devuelve un Map<nombre, cantidad>.
async function getBebidasConsumidasEvento(eventoId) {
    const pedidos = await db.pedido.where('evento_id').equals(eventoId).toArray();
    const mapa = new Map();
    if (pedidos.length === 0) return mapa;

    const ids = pedidos.map(p => p.id);
    const detalles = await db.detalle_pedido.where('pedido_id').anyOf(ids).toArray();

    detalles.forEach(d => {
        if (!d.bebida_elegida) return;
        const drinks = d.bebida_elegida.split(',').map(s => s.trim()).filter(Boolean);
        // Cada nombre de bebida × cantidad del detalle.
        // Ej: si pidió 2x "Combo" con "Coca", son 2 Cocas consumidas.
        drinks.forEach(name => {
            mapa.set(name, (mapa.get(name) || 0) + d.cantidad);
        });
    });
    return mapa;
}

// Devuelve un array de objetos con el stock de cada bebida del evento:
// [{ nombre, inicial, repuesto, total, consumido, restante }]
async function getStockBebidasEvento(eventoId) {
    const filas = await db.stock_bebida.where('evento_id').equals(eventoId).toArray();
    if (filas.length === 0) return [];

    const consumidas = await getBebidasConsumidasEvento(eventoId);

    return filas.map(f => {
        const inicial = f.cantidad_inicial || 0;
        const repuesto = f.cantidad_repuesta || 0;
        const total = inicial + repuesto;
        const consumido = consumidas.get(f.bebida_nombre) || 0;
        const restante = total - consumido;
        return {
            nombre: f.bebida_nombre,
            inicial, repuesto, total, consumido, restante
        };
    });
}
