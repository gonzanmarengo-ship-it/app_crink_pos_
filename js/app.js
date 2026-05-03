// --- Global State ---
let currentEvent = null;
let appConfig = null;
let cart = []; // Array of { product, quantity, subtotal }
let allProducts = []; // Para el panel POS
let currentPOSCategory = 'Todos'; // Filtro activo en la grilla del POS

// --- DOM Elements ---
const views = document.querySelectorAll('.view');
const navBtns = document.querySelectorAll('.nav-btn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const eventStatusIndicator = document.getElementById('nav-event-status');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDb();
        appConfig = await getConfig();
        await updateEventStatus();
        
        setupNavigation();
        setupModals();
        
        // Initial load for active view
        loadPOSView();
        
        console.log("App Initialized Successfully.");
    } catch (error) {
        console.error("Error initializing app:", error);
    }
});

// --- Navigation Logic ---
function setupNavigation() {
    // Sidebar Navigation
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = btn.dataset.target;
            
            // Update active state on buttons
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update active view
            views.forEach(v => v.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
            
            // Trigger specific view load functions
            if (targetId === 'pos-view') loadPOSView();
            else if (targetId === 'admin-view') loadAdminView();
            else if (targetId === 'history-view') loadHistoryView();
        });
    });

    // Admin Tabs Navigation
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            tabContents.forEach(c => c.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            
            // Load specific tab data
            if (tabId === 'admin-events') renderEventsList();
            else if (tabId === 'admin-products') renderAdminProductsList();
            else if (tabId === 'admin-bebidas') renderAdminBebidasList();
            else if (tabId === 'admin-config') renderConfigForm();
        });
    });
}

// --- Status Updates ---
async function updateEventStatus() {
    currentEvent = await getActiveEvent();
    if (currentEvent) {
        eventStatusIndicator.innerHTML = `<span class="status-indicator online"></span> Evento: ${currentEvent.nombre}`;
    } else {
        eventStatusIndicator.innerHTML = `<span class="status-indicator offline"></span> Sin Evento Activo`;
    }
    await renderStockIndicator();
}

// Renderiza el indicador de stock en la barra (oculto si no hay evento o no se cargó stock).
// Verde > 30%, amarillo entre 0% y 30%, rojo si llegó a 0 o negativo.
async function renderStockIndicator() {
    const container = document.getElementById('nav-stock-indicator');
    if (!container) return;

    if (!currentEvent || (currentEvent.stock_inicial_kg || 0) === 0) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    const stock = await getStockEvento(currentEvent.id);
    if (!stock) { container.style.display = 'none'; return; }

    const pct = stock.totalCargado > 0 ? (stock.restante / stock.totalCargado) * 100 : 0;
    let nivel = 'stock-ok';
    if (stock.restante <= 0) nivel = 'stock-out';
    else if (pct < 30) nivel = 'stock-low';

    // Estimación de porciones restantes basada en el gramaje promedio
    // de productos categoría Papas activos (en gramos cocidos).
    const papas = allProducts.filter(p => p.categoria === 'Papas' && p.gramaje_papa > 0);
    let porcionesEstimadas = null;
    if (papas.length > 0 && stock.restante > 0) {
        const gramajePromedio = papas.reduce((acc, p) => acc + p.gramaje_papa, 0) / papas.length;
        // restante (kg crudos) → gramos cocidos: × 700 (rendimiento) × 1000 (kg→g)
        const gramosCocidosRestantes = stock.restante * PAPA_RENDIMIENTO_GR_COCIDOS_POR_KG_CRUDO * 1000;
        porcionesEstimadas = Math.floor(gramosCocidosRestantes / gramajePromedio);
    }

    container.className = `stock-indicator ${nivel}`;
    container.style.display = 'block';
    container.innerHTML = `
        <small>🥔 STOCK PAPA</small>
        <span class="stock-value">${stock.restante.toFixed(2)} kg</span>
        <span class="stock-meta">
            ${porcionesEstimadas !== null ? `≈ ${porcionesEstimadas} porciones` : 'crudos disponibles'}<br>
            Cargado ${stock.totalCargado.toFixed(1)} · Vendido ${stock.consumido.toFixed(2)}
        </span>
        <button id="btn-restock">+ Reponer kilos</button>
    `;
    document.getElementById('btn-restock').onclick = () => openRestockModal();
}

function openRestockModal() {
    if (!currentEvent) { showToast('Necesitás un evento activo.', 'warning'); return; }
    document.getElementById('restock-form').reset();
    document.getElementById('restock-modal').classList.add('active');
}

// Aviso (no bloqueante) si el stock cayó a niveles críticos.
// Se llama después de cada venta. Diseño: avisar UNA vez por umbral
// para no spamear toasts en cada cobro.
let _lastStockWarningLevel = null;
async function checkStockWarning() {
    if (!currentEvent || (currentEvent.stock_inicial_kg || 0) === 0) {
        _lastStockWarningLevel = null;
        return;
    }
    const stock = await getStockEvento(currentEvent.id);
    if (!stock) return;

    let nivel = null;
    if (stock.restante <= 0) nivel = 'out';
    else if (stock.restante / stock.totalCargado < 0.2) nivel = 'low';

    // Solo avisar si CAMBIÓ de nivel (de ok→low, low→out). Evita
    // mostrar el mismo toast en cada cobro si seguís en "low".
    if (nivel && nivel !== _lastStockWarningLevel) {
        if (nivel === 'out') {
            showToast(`⚠️ Stock agotado (${stock.restante.toFixed(2)} kg). Reponé pronto.`, 'error', 4000);
            playBeep(440, 200);
        } else if (nivel === 'low') {
            showToast(`Stock bajo: ${stock.restante.toFixed(2)} kg restantes`, 'warning', 3500);
        }
    }
    _lastStockWarningLevel = nivel;
}

// --- Formatting Helpers ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount);
};

// --- Toast notifications ---
// Crea (si no existe) el contenedor de toasts y devuelve la referencia.
// Lazy-create: no contamina el HTML si nadie llama a showToast().
function getToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.className = 'toast-container';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, type = 'success', duration = 2200) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span style="font-size:18px;">${icons[type] || ''}</span> <span>${message}</span>`;
    container.appendChild(toast);

    // Salida con animación: marcamos clase, removemos después.
    setTimeout(() => {
        toast.classList.add('toast-leaving');
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// Beep de confirmación generado con Web Audio (sin archivo).
// Usa un AudioContext singleton para no spamear contextos.
let _audioCtx = null;
function playBeep(freq = 880, durationMs = 120) {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        // Fade-out exponencial: evita el "pop" feo al cortar de golpe.
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (e) {
        // Si el navegador bloquea el audio, no rompemos la UI.
        console.warn('No se pudo reproducir beep:', e);
    }
}

// --- Modals Setup ---
function setupModals() {
    // Shared close generic modal logic
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.modal').classList.remove('active');
        });
    });
    
    // Close on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
            // Si era el modal de bebidas, también limpiar estado pendiente.
            if (e.target.id === 'drink-selection-modal') resetPendingDrinkState();
        }
    });

    // Payment Modal Cancel
    document.getElementById('cancel-payment').addEventListener('click', () => {
        document.getElementById('payment-modal').classList.remove('active');
    });

    // Drink Selection Modal: cualquier salida (X, Cancelar, click fuera) limpia el estado.
    const closeDrinkModal = () => {
        document.getElementById('drink-selection-modal').classList.remove('active');
        resetPendingDrinkState();
    };
    document.getElementById('cancel-drink-selection').addEventListener('click', closeDrinkModal);
    document.getElementById('close-drink-modal').addEventListener('click', closeDrinkModal);

    // Event Details Modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        if(btn.id === 'close-event-details-modal') {
             btn.addEventListener('click', () => document.getElementById('event-details-modal').classList.remove('active'));
        }
    });

    // Cost Modal Settings
    document.querySelectorAll('.close-modal').forEach(btn => {
        if(btn.id === 'close-cost-modal') {
             btn.addEventListener('click', () => document.getElementById('cost-modal').classList.remove('active'));
        }
    });
}

// ==========================================
// POS VIEW LOGIC
// ==========================================
async function loadPOSView() {
    await updateEventStatus();
    
    // Si no hay evento activo, mostrar un mensaje
    const grid = document.getElementById('pos-products-grid');
    if (!currentEvent) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px; color: var(--text-secondary);"><h3>No hay evento activo.</h3><p>Para comenzar a vender, abre un evento desde Administración.</p></div>';
        return;
    }
    
    // Cargar productos activos
    allProducts = await db.producto.where('activo').equals(1).toArray();
    renderPOSCategoryTabs();
    renderPOSProducts();
    renderCart(); // Limpiar rastro de carrito viejo si lo hubiera
    renderRecentOrders();
    renderPOSTopProducts();
}

// Top 3 productos del evento activo. Se oculta si no hay evento o sin pedidos.
async function renderPOSTopProducts() {
    const container = document.getElementById('pos-top-products');
    if (!container) return;

    if (!currentEvent) {
        container.style.display = 'none';
        return;
    }

    const pedidos = await db.pedido.where('evento_id').equals(currentEvent.id).toArray();
    if (pedidos.length === 0) {
        container.style.display = 'none';
        return;
    }

    const pedidoIds = pedidos.map(p => p.id);
    const detalles = await db.detalle_pedido.where('pedido_id').anyOf(pedidoIds).toArray();

    // Agrupar por nombre histórico (no por producto_id, así si renombrás un
    // producto sigue contando con el snapshot real de venta).
    const conteo = new Map();
    detalles.forEach(d => {
        conteo.set(d.nombre_producto_historico, (conteo.get(d.nombre_producto_historico) || 0) + d.cantidad);
    });

    const top3 = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top3.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    container.innerHTML = `
        <span class="top-label">🔥 Top vendidos</span>
        ${top3.map(([nombre, cant], idx) => `
            <span class="top-item">
                <span class="top-rank">#${idx + 1}</span>
                ${nombre}
                <span class="top-qty">· ${cant}</span>
            </span>
        `).join('')}
    `;
}

function renderPOSCategoryTabs() {
    const container = document.getElementById('pos-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    // Tomamos las categorías reales del catálogo, ordenadas con
    // las "principales" del foodtruck primero y el resto alfabético.
    const ordenPreferido = ['Papas', 'Bebidas', 'Promos'];
    const presentes = new Set(allProducts.map(p => p.categoria));
    const ordenadas = [
        ...ordenPreferido.filter(c => presentes.has(c)),
        ...[...presentes].filter(c => !ordenPreferido.includes(c)).sort()
    ];

    const cats = ['Todos', ...ordenadas];

    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'pos-cat-btn' + (cat === currentPOSCategory ? ' active' : '');
        btn.textContent = cat;
        btn.onclick = () => {
            currentPOSCategory = cat;
            renderPOSCategoryTabs();
            renderPOSProducts();
        };
        container.appendChild(btn);
    });
}

function renderPOSProducts() {
    const grid = document.getElementById('pos-products-grid');
    grid.innerHTML = '';

    // Filtrado en memoria sobre allProducts: evita ir a IndexedDB en cada cambio de tab.
    const visibles = currentPOSCategory === 'Todos'
        ? allProducts
        : allProducts.filter(p => p.categoria === currentPOSCategory);

    if (visibles.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-secondary);">No hay productos activos en "${currentPOSCategory}".</div>`;
        return;
    }

    visibles.forEach(prod => {
        const btn = document.createElement('button');
        btn.className = 'product-btn';
        btn.innerHTML = `
            <span class="product-name">${prod.nombre}</span>
            <span class="product-price">${formatCurrency(prod.precio_venta)}</span>
        `;
        btn.addEventListener('click', () => handleProductClick(prod));
        grid.appendChild(btn);
    });
}

let pendingProductForDrink = null;
let pendingDrinksSelected = [];
let pendingDrinksRequired = 0;

// Helper: limpia el estado del modal de selección de bebidas.
// Debe llamarse después de cancelar o de completar la selección,
// para que la próxima apertura del modal arranque desde cero.
function resetPendingDrinkState() {
    pendingProductForDrink = null;
    pendingDrinksSelected = [];
    pendingDrinksRequired = 0;
    const counter = document.getElementById('drink-counter');
    if (counter) counter.textContent = '0/0';
}

function handleProductClick(product) {
    if (!currentEvent) { showToast('Debes iniciar un evento primero.', 'warning'); return; }
    if ((product.categoria === 'Bebidas' || product.categoria === 'Promos') && product.opciones_bebida) {
        pendingProductForDrink = product;
        
        // Render dynamic buttons
        const optionsContainer = document.getElementById('dynamic-drink-options');
        optionsContainer.innerHTML = '';
        
        const options = product.opciones_bebida.split(',').map(s => s.trim()).filter(s => s !== '');
        
        if (options.length === 0) {
            // Failsafe, no valid options parsed
            addToCart(product);
            return;
        }

        pendingDrinksRequired = product.cantidad_bebidas || 1;
        pendingDrinksSelected = [];
        updateDrinkCounter();

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'pay-method-btn drink-btn';
            btn.style.backgroundColor = '#2a2f3e';
            btn.style.color = '#ffffff';
            btn.textContent = opt;
            btn.addEventListener('click', () => {
                pendingDrinksSelected.push(opt);
                updateDrinkCounter();
                
                if (pendingDrinksSelected.length >= pendingDrinksRequired) {
                    const productWithDrink = { ...pendingProductForDrink };
                    const selectedDrinksString = pendingDrinksSelected.join(', ');
                    addToCart(productWithDrink, selectedDrinksString);

                    document.getElementById('drink-selection-modal').classList.remove('active');
                    resetPendingDrinkState();
                }
            });
            optionsContainer.appendChild(btn);
        });

        document.getElementById('drink-selection-modal').classList.add('active');
    } else {
        addToCart(product);
    }
}

function updateDrinkCounter() {
    const counterDiv = document.getElementById('drink-counter');
    if (counterDiv) {
        counterDiv.textContent = `${pendingDrinksSelected.length}/${pendingDrinksRequired}`;
    }
}

function addToCart(product, bebidaElegida = null) {
    if (!currentEvent) { showToast('Debes iniciar un evento primero.', 'warning'); return; }
    
    // Si tiene bebida elegida, forzar la creación de un nuevo ítem siempre
    // Si no tiene, buscar si ya existe para agruparlo
    let existingItem = null;
    if (!bebidaElegida) {
        existingItem = cart.find(item => item.product.id === product.id && !item.bebidaElegida);
    }
    
    if (existingItem) {
        existingItem.quantity += 1;
        existingItem.subtotal = existingItem.quantity * product.precio_venta;
    } else {
        // Generar un id único temporal para los ítems del carrito
        const tempId = Date.now() + Math.random();
        cart.push({
            tempId: tempId,
            product: product,
            bebidaElegida: bebidaElegida,
            quantity: 1,
            subtotal: product.precio_venta
        });
    }
    renderCart();
}

function updateCartQuantity(tempId, delta) {
    const itemIndex = cart.findIndex(item => item.tempId === tempId);
    if (itemIndex === -1) return;
    
    const item = cart[itemIndex];
    item.quantity += delta;
    
    if (item.quantity <= 0) {
        cart.splice(itemIndex, 1);
    } else {
        item.subtotal = item.quantity * item.product.precio_venta;
    }
    
    renderCart();
}

function renderCart() {
    const cartContainer = document.getElementById('cart-items');
    cartContainer.innerHTML = '';
    
    let total = 0;
    
    cart.forEach(item => {
        total += item.subtotal;
        
        // Formatear display para múltiples bebidas: "Nombre (+ X bebidas) (Bebida 1, Bebida 2)"
        let displayName = item.product.nombre;
        if (item.bebidaElegida && item.product.cantidad_bebidas > 1) {
            displayName = `${item.product.nombre} + ${item.product.cantidad_bebidas} bebidas (${item.bebidaElegida})`;
        } else if (item.bebidaElegida) {
            displayName = `${item.product.nombre} (${item.bebidaElegida})`;
        }
        
        const el = document.createElement('div');
        el.className = 'cart-item';
        el.innerHTML = `
            <div class="item-info">
                <span class="item-name">${displayName}</span>
                <span class="item-price">${formatCurrency(item.product.precio_venta)} x ${item.quantity}</span>
            </div>
            <div class="item-controls">
                <button class="qty-btn minus" data-tempid="${item.tempId}">-</button>
                <button class="qty-btn add" data-tempid="${item.tempId}">+</button>
                <div class="item-subtotal">${formatCurrency(item.subtotal)}</div>
            </div>
        `;
        cartContainer.appendChild(el);
    });
    
    // Bind buttons in cart
    cartContainer.querySelectorAll('.minus').forEach(btn => {
        btn.addEventListener('click', (e) => updateCartQuantity(parseFloat(e.target.dataset.tempid), -1));
    });
    cartContainer.querySelectorAll('.add').forEach(btn => {
        btn.addEventListener('click', (e) => updateCartQuantity(parseFloat(e.target.dataset.tempid), 1));
    });
    
    // Update total
    document.getElementById('cart-subtotal').textContent = formatCurrency(total);
    
    // Toggle Pay button
    const btnPay = document.getElementById('btn-pay');
    btnPay.disabled = cart.length === 0;
    
    // Setup Pay Modal trigger
    btnPay.onclick = () => {
        if (cart.length > 0) showPaymentModal(total);
    };
}

function showPaymentModal(totalBruto) {
    document.getElementById('payment-total-amount').textContent = formatCurrency(totalBruto);
    
    const posnetInfo = document.getElementById('posnet-fee-info');
    if (appConfig) {
        posnetInfo.innerHTML = `(Comisión ${appConfig.porcentaje_comision_posnet}% <br> Neto: ${formatCurrency(totalBruto * (1 - appConfig.porcentaje_comision_posnet/100))})`;
    }
    
    // Bind payment buttons
    document.querySelectorAll('.pay-method-btn').forEach(btn => {
        btn.onclick = () => processPayment(btn.dataset.method, totalBruto);
    });
    
    document.getElementById('payment-modal').classList.add('active');
}

async function processPayment(metodo, totalBruto) {
     if (!currentEvent) return;
     
     let totalNeto = totalBruto;
     let comisionPosnet = 0;
     
     if (metodo === 'posnet' && appConfig) {
         comisionPosnet = totalBruto * (appConfig.porcentaje_comision_posnet / 100);
         totalNeto = totalBruto - comisionPosnet;
     }
     
     const now = new Date();
     
     try {
         // Start transaction for consistency
         await db.transaction('rw', db.pedido, db.detalle_pedido, async () => {

             // Próximo número de pedido: max(numeros usados) + 1.
             // Usar count+1 falla si se borró un pedido del medio (colisión de número).
             const pedidosEvento = await db.pedido.where('evento_id').equals(currentEvent.id).toArray();
             const proximoNumero = pedidosEvento.length > 0
                 ? Math.max(...pedidosEvento.map(p => p.numero_pedido || 0)) + 1
                 : 1;

             const pedidoId = await db.pedido.add({
                 numero_pedido: proximoNumero,
                 evento_id: currentEvent.id,
                 fecha_hora: now,
                 total_bruto: totalBruto,
                 medio_pago: metodo,
                 comision_posnet: comisionPosnet,
                 total_neto: totalNeto,
                 estado: 'confirmado'
             });
             
             // Add details copying current values (Snapshot)
             const detallesToInsert = cart.map(item => ({
                 pedido_id: pedidoId,
                 producto_id: item.product.id,
                 nombre_producto_historico: item.product.nombre,
                 precio_unitario_historico: item.product.precio_venta,
                 costo_unitario_historico: item.product.costo_unitario,
                 gramaje_historico: item.product.gramaje_papa,
                 bebida_elegida: item.bebidaElegida || null,
                 cantidad: item.quantity,
                 subtotal: item.subtotal
             }));
             
             await db.detalle_pedido.bulkAdd(detallesToInsert);
         });
         
         // Success
         cart = []; // clear cart
         renderCart();
         renderRecentOrders(); // Actualizar lista de recientes al procesar
         renderPOSTopProducts(); // El ranking puede haber cambiado
         document.getElementById('payment-modal').classList.remove('active');

         showToast(`Pedido cobrado · ${formatCurrency(totalNeto)} (${metodo})`, 'success');
         playBeep();

         // Actualizar indicador de stock; si cayó a 0/negativo, avisar.
         await renderStockIndicator();
         await checkStockWarning();

     } catch (err) {
         console.error("Error validando pedido: ", err);
         showToast('Error al procesar el pago.', 'error', 3500);
     }
}

async function renderRecentOrders() {
    const listContainer = document.getElementById('pos-recent-orders');
    if (!listContainer) return;
    if (!currentEvent) {
        listContainer.innerHTML = '';
        return;
    }

    const pedidos = await db.pedido
        .where('evento_id').equals(currentEvent.id)
        .reverse()
        .limit(10)
        .toArray();

    listContainer.innerHTML = '';

    if (pedidos.length === 0) {
        listContainer.innerHTML = '<p style="color: var(--text-secondary);">No hay pedidos recientes en este evento.</p>';
        return;
    }

    for (let p of pedidos) {
        const detalles = await db.detalle_pedido.where('pedido_id').equals(p.id).toArray();
        let desc = detalles.map(d => `${d.cantidad}x ${d.nombre_producto_historico}${d.bebida_elegida ? ` (${d.bebida_elegida})` : ''}`).join(', ');
        
        const el = document.createElement('div');
        el.className = 'list-item'; // Reutilizamos clase
        el.style.backgroundColor = 'var(--bg-dark)';
        
        el.innerHTML = `
            <div class="list-item-info">
                <strong>Pedido #${p.numero_pedido} - ${formatCurrency(p.total_bruto)}</strong>
                <span style="display:block; margin-top:5px;">${desc}</span>
                <span style="display:block; margin-top:5px; color: var(--primary); font-weight:600;">${p.medio_pago.toUpperCase()} | ${new Date(p.fecha_hora).toLocaleTimeString()}</span>
            </div>
            <div class="list-item-actions">
                <button class="btn-primary edit-order-btn" data-id="${p.id}">Modificar</button>
                <button class="btn-danger del-order-btn" data-id="${p.id}">Eliminar</button>
            </div>
        `;
        listContainer.appendChild(el);
    }

    listContainer.querySelectorAll('.del-order-btn').forEach(btn => {
        btn.onclick = () => deleteOrder(parseInt(btn.dataset.id));
    });

    listContainer.querySelectorAll('.edit-order-btn').forEach(btn => {
        btn.onclick = () => editOrder(parseInt(btn.dataset.id));
    });
}

async function deleteOrder(id) {
    if (!confirm('¿Seguro que deseas eliminar este pedido? Esta acción no se puede deshacer.')) return;
    try {
        await db.transaction('rw', db.pedido, db.detalle_pedido, async () => {
            await db.detalle_pedido.where('pedido_id').equals(id).delete();
            await db.pedido.delete(id);
        });
        renderRecentOrders();
    } catch(err) {
        console.error("Error eliminando pedido:", err);
        showToast('Error al eliminar el pedido.', 'error');
    }
}

async function editOrder(id) {
    if (cart.length > 0) {
        if (!confirm('Tenés un ticket en curso. Si continuás, se borrará para cargar el pedido a modificar. ¿Continuar?')) return;
    }
    
    try {
        const pedido = await db.pedido.get(id);
        if (!pedido) return;
        const detalles = await db.detalle_pedido.where('pedido_id').equals(id).toArray();
        
        cart = [];
        for (let d of detalles) {
            let prod = await db.producto.get(d.producto_id);
            if (!prod) {
                // Producto fue borrado del catálogo: reconstruimos uno "fantasma"
                // a partir del snapshot histórico guardado en el detalle.
                // Para cantidad_bebidas, contamos bebidas reales del string
                // (ej "Coca, Sprite" → 2) en vez de asumir 1.
                const bebidasCount = d.bebida_elegida
                    ? d.bebida_elegida.split(',').filter(s => s.trim()).length
                    : 0;
                prod = {
                    id: d.producto_id,
                    nombre: d.nombre_producto_historico,
                    precio_venta: d.precio_unitario_historico,
                    costo_unitario: d.costo_unitario_historico,
                    gramaje_papa: d.gramaje_historico,
                    cantidad_bebidas: bebidasCount
                };
            }
            
            cart.push({
                tempId: Date.now() + Math.random(),
                product: prod,
                bebidaElegida: d.bebida_elegida,
                quantity: d.cantidad,
                subtotal: d.subtotal
            });
        }
        
        await db.transaction('rw', db.pedido, db.detalle_pedido, async () => {
            await db.detalle_pedido.where('pedido_id').equals(id).delete();
            await db.pedido.delete(id);
        });
        
        renderCart();
        renderRecentOrders();
        
    } catch(err) {
        console.error("Error modificando pedido:", err);
        showToast('Error al modificar el pedido.', 'error');
    }
}

// ==========================================
// ADMIN VIEW LOGIC
// ==========================================
function loadAdminView() {
    renderEventsList();
    renderAdminProductsList();
    renderAdminBebidasList();
    renderConfigForm();
}

async function renderAdminProductsList() {
    const container = document.getElementById('products-list');
    container.innerHTML = 'Cargando...';
    
    const prods = await db.producto.toArray();
    container.innerHTML = '';
    
    if (prods.length === 0) {
        container.innerHTML = '<p>No hay productos.</p>';
    } else {
        prods.forEach(p => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="list-item-info">
                    <strong>${p.nombre}</strong>
                    <span>${formatCurrency(p.precio_venta)} - ${p.categoria} - ${p.activo ? 'Activo' : 'Inactivo'}</span>
                </div>
                <div class="list-item-actions">
                    <button class="btn-primary edit-prod-btn" data-id="${p.id}">Editar</button>
                    <button class="btn-danger del-prod-btn" data-id="${p.id}" style="margin-left: 5px;">Borrar</button>
                </div>
            `;
            container.appendChild(div);
        });
        
        // Bind Edit buttons
        document.querySelectorAll('.edit-prod-btn').forEach(btn => {
            btn.onclick = async () => {
                const prodId = parseInt(btn.dataset.id);
                const prod = await db.producto.get(prodId);
                if (prod) openProductModal(prod);
            }
        });
        
        // Bind Delete buttons
        document.querySelectorAll('.del-prod-btn').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('¿Estás seguro de que deseas eliminar este producto?')) {
                    const prodId = parseInt(btn.dataset.id);
                    await db.producto.delete(prodId);
                    const idx = allProducts.findIndex(p => p.id === prodId);
                    if (idx !== -1) allProducts.splice(idx, 1);
                    renderAdminProductsList();
                    renderPOSCategoryTabs();
                    renderPOSProducts();
                }
            };
        });
    }
}

async function renderEventsList() {
    const container = document.getElementById('events-list');
    container.innerHTML = 'Cargando...';
    
    // Sort by desc starts
    const events = await db.evento.reverse().toArray();
    container.innerHTML = '';
    
    events.forEach(ev => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.borderLeft = ev.estado === 'activo' ? '4px solid var(--success)' : '4px solid transparent';
        
        div.innerHTML = `
            <div class="list-item-info">
                <strong><a href="#" class="event-name-link" data-id="${ev.id}" style="text-decoration: none; color: var(--primary); font-size: 16px;">${ev.nombre}</a> ${ev.estado === 'activo' ? '<span style="color:var(--success); font-size: 12px;">(ACTIVO)</span>' : ''}</strong>
                <span>${new Date(ev.fecha_inicio).toLocaleDateString()} - ${ev.lugar || 'Sin lugar'}</span>
            </div>
            <div class="list-item-actions">
                ${ev.estado === 'finalizado' 
                    ? `<button class="btn-primary open-ev-btn" data-id="${ev.id}">Re-Abrir</button>`
                    : `<button class="btn-danger close-ev-btn" data-id="${ev.id}">Finalizar</button>`
                }
                <button class="btn-danger del-ev-btn" data-id="${ev.id}" style="margin-left: 5px;">Borrar</button>
            </div>
        `;
        container.appendChild(div);
    });
    
    // Bind close/open events.
    // "Cerrar" intercepta para abrir el modal de cierre de caja
    // (si el evento trackea efectivo_inicial > 0).
    document.querySelectorAll('.close-ev-btn').forEach(btn => {
        btn.onclick = async () => {
            const evId = parseInt(btn.dataset.id);
            const ev = await db.evento.get(evId);
            if (ev && (ev.efectivo_inicial || 0) > 0) {
                openCashCloseModal(evId);
            } else {
                // Sin caja inicial cargada: cierre directo (eventos viejos)
                toggleEventStatus(evId, 'finalizado');
            }
        };
    });
    document.querySelectorAll('.open-ev-btn').forEach(btn => {
        btn.onclick = async () => toggleEventStatus(parseInt(btn.dataset.id), 'activo');
    });
    
    // Bind Event Name Click for Details
    document.querySelectorAll('.event-name-link').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            openEventDetailsModal(parseInt(link.dataset.id));
        };
    });
    
    // Bind delete events
    document.querySelectorAll('.del-ev-btn').forEach(btn => {
        btn.onclick = async () => {
            if (confirm('¿Estás seguro de eliminar este evento y todos sus datos (pedidos, costos)? Esta acción es irreversible.')) {
                const evId = parseInt(btn.dataset.id);
                
                try {
                    await db.transaction('rw', db.evento, db.pedido, db.detalle_pedido, db.costo_extra, async () => {
                        // Get all orders for this event
                        const pedidos = await db.pedido.where('evento_id').equals(evId).toArray();
                        
                        // Delete order details
                        for (let p of pedidos) {
                            await db.detalle_pedido.where('pedido_id').equals(p.id).delete();
                        }
                        
                        // Delete orders
                        await db.pedido.where('evento_id').equals(evId).delete();
                        
                        // Delete extra costs
                        await db.costo_extra.where('evento_id').equals(evId).delete();
                        
                        // Delete event itself
                        await db.evento.delete(evId);
                    });
                    
                    renderEventsList();
                    const activeEv = await getActiveEvent();
                    if (!activeEv || activeEv.id !== currentEvent?.id) {
                        await updateEventStatus();
                        loadPOSView(); // reload POS info
                    }
                } catch (err) {
                    console.error("Error al eliminar evento: ", err);
                    showToast('Error al eliminar el evento.', 'error');
                }
            }
        };
    });
}

function openCostModal(eventId) {
    document.getElementById('cost-form').reset();
    document.getElementById('cost-evento-id').value = eventId;
    document.getElementById('cost-modal').classList.add('active');
}

document.getElementById('cost-form').onsubmit = async (e) => {
    e.preventDefault();
    const eventId = parseInt(document.getElementById('cost-evento-id').value);
    const monto = parseFloat(document.getElementById('cost-monto').value);
    const desc = document.getElementById('cost-desc').value;

    await db.costo_extra.add({
        evento_id: eventId,
        fecha: new Date(),
        monto: monto,
        descripcion: desc
    });

    document.getElementById('cost-modal').classList.remove('active');
    showToast('Costo agregado exitosamente.', 'success');
};

async function openEventDetailsModal(eventId) {
    const evt = await db.evento.get(eventId);
    if (!evt) return;

    document.getElementById('event-details-title').textContent = `Costos: ${evt.nombre}`;
    resetCostForm(eventId);

    await renderEventCosts(eventId);

    document.getElementById('event-details-modal').classList.add('active');
}

// Resetea el form a modo "crear nuevo costo"
function resetCostForm(eventId) {
    document.getElementById('detail-cost-form').reset();
    document.getElementById('detail-cost-evento-id').value = eventId;
    document.getElementById('detail-cost-id').value = '';
    document.getElementById('detail-cost-form-title').textContent = 'Agregar Nuevo Costo';
    document.getElementById('detail-cost-submit').textContent = 'Guardar Costo';
    document.getElementById('detail-cost-cancel').style.display = 'none';
}

// Carga un costo existente en el form para editarlo
function loadCostForEdit(costo) {
    document.getElementById('detail-cost-evento-id').value = costo.evento_id;
    document.getElementById('detail-cost-id').value = costo.id;
    document.getElementById('detail-cost-desc').value = costo.descripcion;
    document.getElementById('detail-cost-monto').value = costo.monto;
    document.getElementById('detail-cost-form-title').textContent = 'Editando Costo';
    document.getElementById('detail-cost-submit').textContent = 'Actualizar Costo';
    document.getElementById('detail-cost-cancel').style.display = 'inline-block';
}

async function renderEventCosts(eventId) {
    const costos = await db.costo_extra.where('evento_id').equals(eventId).toArray();
    const listContainer = document.getElementById('event-costs-list');
    const totalContainer = document.getElementById('event-costs-total');

    listContainer.innerHTML = '';
    let total = 0;

    if (costos.length === 0) {
        listContainer.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 10px;">No hay costos registrados para este evento.</p>';
    } else {
        costos.forEach(c => {
            total += c.monto;
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.gap = '10px';
            item.style.padding = '8px 0';
            item.style.borderBottom = '1px solid var(--bg-card)';
            item.innerHTML = `
                <span style="flex: 1;">${c.descripcion}</span>
                <span style="font-weight: 500; min-width: 90px; text-align: right;">${formatCurrency(c.monto)}</span>
                <span style="display: flex; gap: 5px;">
                    <button type="button" class="btn-primary edit-cost-btn" data-id="${c.id}" style="padding: 4px 10px; font-size: 12px;">Editar</button>
                    <button type="button" class="btn-danger del-cost-btn" data-id="${c.id}" style="padding: 4px 10px; font-size: 12px;">Borrar</button>
                </span>
            `;
            listContainer.appendChild(item);
        });

        // Bind acciones por fila (event delegation no aplica acá: re-renderizamos cada vez)
        listContainer.querySelectorAll('.edit-cost-btn').forEach(btn => {
            btn.onclick = async () => {
                const c = await db.costo_extra.get(parseInt(btn.dataset.id));
                if (c) loadCostForEdit(c);
            };
        });
        listContainer.querySelectorAll('.del-cost-btn').forEach(btn => {
            btn.onclick = async () => {
                if (!confirm('¿Eliminar este costo?')) return;
                await db.costo_extra.delete(parseInt(btn.dataset.id));
                resetCostForm(eventId);
                await renderEventCosts(eventId);
            };
        });
    }

    totalContainer.textContent = `Total: ${formatCurrency(total)}`;
}

document.getElementById('detail-cost-cancel').onclick = () => {
    const eventId = parseInt(document.getElementById('detail-cost-evento-id').value);
    resetCostForm(eventId);
};

document.getElementById('detail-cost-form').onsubmit = async (e) => {
    e.preventDefault();
    const eventId = parseInt(document.getElementById('detail-cost-evento-id').value);
    const costId = document.getElementById('detail-cost-id').value;
    const monto = parseFloat(document.getElementById('detail-cost-monto').value);
    const desc = document.getElementById('detail-cost-desc').value;

    if (costId) {
        // Modo edición: preserva fecha original, actualiza desc/monto
        await db.costo_extra.update(parseInt(costId), { monto, descripcion: desc });
    } else {
        // Modo creación
        await db.costo_extra.add({
            evento_id: eventId,
            fecha: new Date(),
            monto: monto,
            descripcion: desc
        });
    }

    resetCostForm(eventId);
    await renderEventCosts(eventId);
};

function renderConfigForm() {
    if (appConfig) {
        document.getElementById('config-business-name').value = appConfig.nombre_negocio;
        document.getElementById('config-posnet-fee').value = appConfig.porcentaje_comision_posnet;
    }
}

// Bebidas Management
async function renderAdminBebidasList() {
    const container = document.getElementById('bebidas-list');
    container.innerHTML = 'Cargando...';
    
    const bebidas = await db.bebida.toArray();
    container.innerHTML = '';
    
    if (bebidas.length === 0) {
        container.innerHTML = '<p>No hay bebidas configuradas.</p>';
    } else {
        bebidas.forEach(b => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="list-item-info">
                    <strong>${b.nombre}</strong>
                </div>
                <div class="list-item-actions">
                    <button class="btn-primary edit-bebida-btn" data-id="${b.id}">Editar</button>
                    <button class="btn-danger del-bebida-btn" data-id="${b.id}" style="margin-left: 5px;">Borrar</button>
                </div>
            `;
            container.appendChild(div);
        });
        
        document.querySelectorAll('.edit-bebida-btn').forEach(btn => {
            btn.onclick = async () => {
                const bId = parseInt(btn.dataset.id);
                const b = await db.bebida.get(bId);
                if (b) openBebidaModal(b);
            }
        });
        
        document.querySelectorAll('.del-bebida-btn').forEach(btn => {
            btn.onclick = async () => {
                if (confirm('¿Estás seguro de que deseas eliminar esta bebida?')) {
                    const bId = parseInt(btn.dataset.id);
                    await db.bebida.delete(bId);
                    renderAdminBebidasList();
                }
            };
        });
    }
}

document.getElementById('btn-new-bebida').onclick = () => openBebidaModal();

function openBebidaModal(bebida = null) {
    document.getElementById('bebida-form').reset();
    document.getElementById('bebida-modal-title').textContent = bebida ? 'Editar Bebida' : 'Nueva Bebida';
    document.getElementById('bebida-id').value = bebida ? bebida.id : '';
    document.getElementById('bebida-nombre').value = bebida ? bebida.nombre : '';
    document.getElementById('bebida-modal').classList.add('active');
}

document.getElementById('bebida-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('bebida-id').value;
    const nombre = document.getElementById('bebida-nombre').value;
    if (id) {
        await db.bebida.update(parseInt(id), { nombre: nombre });
    } else {
        await db.bebida.add({ nombre: nombre });
    }
    document.getElementById('bebida-modal').classList.remove('active');
    renderAdminBebidasList();
};

// Product Management
document.getElementById('btn-new-product').onclick = () => openProductModal();

async function openProductModal(prod = null) {
    const form = document.getElementById('product-form');
    document.getElementById('product-modal-title').textContent = prod ? 'Editar Producto' : 'Nuevo Producto';
    
    document.getElementById('prod-id').value = prod ? prod.id : '';
    document.getElementById('prod-nombre').value = prod ? prod.nombre : '';
    document.getElementById('prod-categoria').value = prod ? prod.categoria : 'Papas';
    document.getElementById('prod-precio').value = prod ? prod.precio_venta : '';
    document.getElementById('prod-costo').value = prod ? prod.costo_unitario : '';
    document.getElementById('prod-gramaje').value = prod ? prod.gramaje_papa : '0';
    document.getElementById('prod-cant-bebidas').value = prod ? (prod.cantidad_bebidas || 1) : 1;
    document.getElementById('prod-activo').checked = prod ? (prod.activo === 1) : true;
    
    // Load beverages checkboxes
    const prodBebidas = (prod && prod.opciones_bebida) ? prod.opciones_bebida.split(',').map(s=>s.trim()) : [];
    const bebidasContainer = document.getElementById('prod-bebidas-checkboxes');
    bebidasContainer.innerHTML = 'Cargando...';
    
    const allBebidas = await db.bebida.toArray();
    bebidasContainer.innerHTML = '';
    
    if (allBebidas.length === 0) {
        bebidasContainer.innerHTML = '<span style="color:var(--text-secondary); font-size:14px;">No hay bebidas creadas. Créalas en la pestaña Bebidas.</span>';
    } else {
        allBebidas.forEach(b => {
            const lbl = document.createElement('label');
            lbl.style.display = 'flex';
            lbl.style.alignItems = 'center';
            lbl.style.gap = '5px';
            lbl.style.cursor = 'pointer';
            lbl.style.fontSize = '14px';
            
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'bebida-checkbox';
            chk.value = b.nombre;
            if (prodBebidas.includes(b.nombre)) chk.checked = true;
            
            lbl.appendChild(chk);
            lbl.appendChild(document.createTextNode(b.nombre));
            bebidasContainer.appendChild(lbl);
        });
    }
    
    // Logic for hiding/disabling fields based on category
    const catSelect = document.getElementById('prod-categoria');
    const gramajeInput = document.getElementById('prod-gramaje');
    const bebidasGroup = document.getElementById('prod-bebidas-group');
    
    const updateCategoryState = () => {
        const cat = catSelect.value;
        if (cat === 'Bebidas') {
            gramajeInput.value = '0';
            gramajeInput.disabled = true;
            bebidasGroup.style.display = 'block';
        } else if (cat === 'Promos') {
            gramajeInput.disabled = false;
            bebidasGroup.style.display = 'block';
        } else {
            gramajeInput.disabled = false;
            bebidasGroup.style.display = 'none';
        }
    };
    
    // Update initially
    updateCategoryState();
    
    // Listen for changes
    catSelect.onchange = updateCategoryState;

    document.getElementById('product-modal').classList.add('active');
}

document.getElementById('product-form').onsubmit = async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('prod-id').value;
    const cat = document.getElementById('prod-categoria').value;
    
    let opcionesBebidaRaw = '';
    const chks = document.querySelectorAll('.bebida-checkbox:checked');
    const selecs = Array.from(chks).map(c => c.value);
    opcionesBebidaRaw = selecs.join(', ');
    
    // Only save options if category is Bebidas or Promos, else empty string
    const opcionesBebida = (cat === 'Bebidas' || cat === 'Promos') ? opcionesBebidaRaw : '';
    const cantidadBebidas = (cat === 'Bebidas' || cat === 'Promos') ? (parseInt(document.getElementById('prod-cant-bebidas').value) || 1) : 0;

    const data = {
        nombre: document.getElementById('prod-nombre').value,
        categoria: cat,
        precio_venta: parseFloat(document.getElementById('prod-precio').value),
        costo_unitario: parseFloat(document.getElementById('prod-costo').value),
        gramaje_papa: parseInt(document.getElementById('prod-gramaje').value) || 0,
        activo: document.getElementById('prod-activo').checked ? 1 : 0,
        opciones_bebida: opcionesBebida,
        cantidad_bebidas: cantidadBebidas
    };
    
    if (id) {
        await db.producto.update(parseInt(id), data);
    } else {
        await db.producto.add(data);
    }
    
    document.getElementById('product-modal').classList.remove('active');
    renderAdminProductsList();
};

// Event Management
document.getElementById('btn-new-event').onclick = () => {
    document.getElementById('event-form').reset();
    document.getElementById('ev-id').value = '';
    document.getElementById('ev-stock-inicial').value = '0';
    document.getElementById('ev-efectivo-inicial').value = '0';
    document.getElementById('event-modal-title').textContent = 'Nuevo Evento';
    // En modo creación mostramos los campos de stock y caja inicial
    toggleEventFormInitialFields(true);
    document.getElementById('event-modal').classList.add('active');
};

// Muestra u oculta los campos de stock_inicial / efectivo_inicial.
// Solo se cargan al CREAR un evento; al editar quedan ocultos para no
// pisar el progreso (ver comentario en el handler del form).
function toggleEventFormInitialFields(show) {
    const stockField = document.getElementById('ev-stock-inicial').closest('.form-row');
    if (stockField) stockField.style.display = show ? 'flex' : 'none';
}

document.getElementById('event-form').onsubmit = async (e) => {
    e.preventDefault();

    const id = document.getElementById('ev-id').value;
    const stockInicial = parseFloat(document.getElementById('ev-stock-inicial').value) || 0;
    const efectivoInicial = parseFloat(document.getElementById('ev-efectivo-inicial').value) || 0;

    const data = {
        nombre: document.getElementById('ev-nombre').value,
        lugar: document.getElementById('ev-lugar').value,
        observaciones: document.getElementById('ev-obs').value
    };

    if (id) {
        // Edición: solo actualizo metadata, NO toco stock/efectivo (esos
        // los maneja el cierre y el botón de reponer; sobreescribir acá
        // borraría el progreso del evento).
        await db.evento.update(parseInt(id), data);
    } else {
        // Creación: cierra cualquier evento activo y abre el nuevo.
        const activos = await db.evento.where('estado').equals('activo').toArray();
        for (let eq of activos) {
            await db.evento.update(eq.id, { estado: 'finalizado' });
        }
        data.fecha_inicio = new Date();
        data.estado = 'activo';
        data.stock_inicial_kg = stockInicial;
        data.stock_repuesto_kg = 0;
        data.efectivo_inicial = efectivoInicial;
        data.efectivo_final = null;
        await db.evento.add(data);
    }

    document.getElementById('event-modal').classList.remove('active');
    renderEventsList();
    updateEventStatus();
};

// Reponer stock: suma a evento.stock_repuesto_kg.
document.getElementById('restock-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!currentEvent) return;
    const kg = parseFloat(document.getElementById('restock-kg').value);
    if (!kg || kg <= 0) return;

    const ev = await db.evento.get(currentEvent.id);
    const nuevoRepuesto = (ev.stock_repuesto_kg || 0) + kg;
    await db.evento.update(currentEvent.id, { stock_repuesto_kg: nuevoRepuesto });

    // Refresca el currentEvent en memoria para que el indicador refleje el cambio
    currentEvent.stock_repuesto_kg = nuevoRepuesto;

    document.getElementById('restock-modal').classList.remove('active');
    showToast(`+${kg} kg sumados al stock`, 'success');
    await renderStockIndicator();
};

document.getElementById('close-restock-modal').onclick = () => {
    document.getElementById('restock-modal').classList.remove('active');
};

// Abre el modal de cierre de caja para un evento.
// Calcula y muestra: caja inicial, ventas en efectivo, esperado al cerrar.
async function openCashCloseModal(eventoId) {
    const ev = await db.evento.get(eventoId);
    if (!ev) return;

    const pedidos = await db.pedido.where('evento_id').equals(eventoId).toArray();
    const ventasEfectivo = pedidos
        .filter(p => p.medio_pago === 'efectivo')
        .reduce((acc, p) => acc + p.total_bruto, 0);

    const inicial = ev.efectivo_inicial || 0;
    const esperado = inicial + ventasEfectivo;

    document.getElementById('cashclose-evento-id').value = eventoId;
    document.getElementById('cashclose-form').reset();
    document.getElementById('cashclose-counted').value = esperado.toFixed(0);
    document.getElementById('cashclose-diff').style.display = 'none';

    document.getElementById('cashclose-summary').innerHTML = `
        <div style="background: var(--bg-card); padding: 14px; border-radius: var(--radius-md); display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px;">
            <div><small style="color: var(--text-secondary);">Caja inicial</small><br><strong>${formatCurrency(inicial)}</strong></div>
            <div><small style="color: var(--text-secondary);">Ventas en efectivo</small><br><strong>${formatCurrency(ventasEfectivo)}</strong></div>
            <div style="grid-column: 1/-1; border-top: 1px solid var(--bg-darker); padding-top: 10px;">
                <small style="color: var(--text-secondary);">Esperado en caja</small><br>
                <strong style="font-size: 22px; color: var(--primary);">${formatCurrency(esperado)}</strong>
            </div>
        </div>
    `;

    // Live diff: cuando el usuario tipea, mostramos sobrante/faltante en vivo.
    const countedInput = document.getElementById('cashclose-counted');
    const diffBox = document.getElementById('cashclose-diff');
    const updateDiff = () => {
        const counted = parseFloat(countedInput.value) || 0;
        const diff = counted - esperado;
        if (Math.abs(diff) < 1) {
            diffBox.style.background = 'rgba(16, 185, 129, 0.15)';
            diffBox.style.color = 'var(--success)';
            diffBox.innerHTML = `✅ La caja cuadra exactamente.`;
        } else if (diff > 0) {
            diffBox.style.background = 'rgba(245, 158, 11, 0.15)';
            diffBox.style.color = 'var(--warning)';
            diffBox.innerHTML = `⚠️ Sobrante: <strong>${formatCurrency(diff)}</strong> (más efectivo del esperado)`;
        } else {
            diffBox.style.background = 'rgba(239, 68, 68, 0.15)';
            diffBox.style.color = 'var(--danger)';
            diffBox.innerHTML = `❌ Faltante: <strong>${formatCurrency(Math.abs(diff))}</strong>`;
        }
        diffBox.style.display = 'block';
    };
    countedInput.oninput = updateDiff;
    updateDiff();

    document.getElementById('cashclose-modal').classList.add('active');
}

document.getElementById('close-cashclose-modal').onclick = () => {
    document.getElementById('cashclose-modal').classList.remove('active');
};

document.getElementById('cashclose-form').onsubmit = async (e) => {
    e.preventDefault();
    const eventoId = parseInt(document.getElementById('cashclose-evento-id').value);
    const final = parseFloat(document.getElementById('cashclose-counted').value);

    await db.evento.update(eventoId, {
        efectivo_final: final,
        estado: 'finalizado'
    });

    document.getElementById('cashclose-modal').classList.remove('active');
    showToast('Caja cerrada y evento finalizado.', 'success');
    await renderEventsList();
    await updateEventStatus();
};

async function toggleEventStatus(id, newStatus) {
    if (newStatus === 'activo') {
         // Close others
         const activos = await db.evento.where('estado').equals('activo').toArray();
         for(let eq of activos) {
             if(eq.id !== id) await db.evento.update(eq.id, { estado: 'finalizado' });
         }
    }
    await db.evento.update(id, { estado: newStatus });
    renderEventsList();
    updateEventStatus();
}

// ==========================================
// BACKUP / RESTORE
// ==========================================

// Exporta TODAS las tablas a un JSON único.
// Uso introspección sobre db.tables: si mañana agrego una tabla,
// el backup la incluye sin tener que tocar este código.
async function exportBackup() {
    try {
        const dump = {
            app: 'CRINK_POS',
            dbVersion: db.verno,
            exportedAt: new Date().toISOString(),
            tables: {}
        };

        for (const table of db.tables) {
            dump.tables[table.name] = await table.toArray();
        }

        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const fecha = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `crink_backup_${fecha}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Backup exportado. Guardalo en lugar seguro.', 'success', 3500);
    } catch (err) {
        console.error('Error exportando backup:', err);
        showToast('Error al exportar backup.', 'error');
    }
}

// Importa un JSON de backup. Sobrescribe TODO (después de confirmar).
async function importBackup(file) {
    try {
        const text = await file.text();
        const dump = JSON.parse(text);

        // Validación básica del formato
        if (dump.app !== 'CRINK_POS' || !dump.tables) {
            showToast('El archivo no es un backup válido de CRINK POS.', 'error', 4000);
            return;
        }

        const conteos = Object.entries(dump.tables)
            .map(([name, rows]) => `${rows.length} ${name}`)
            .join(', ');

        const ok = confirm(
            `¿Restaurar este backup?\n\n` +
            `Fecha: ${new Date(dump.exportedAt).toLocaleString()}\n` +
            `Contenido: ${conteos}\n\n` +
            `⚠️ Se BORRARÁN todos los datos actuales.`
        );
        if (!ok) return;

        // Aviso si las versiones difieren mucho.
        if (dump.dbVersion && dump.dbVersion > db.verno) {
            const cont = confirm(
                `El backup viene de una versión más nueva (v${dump.dbVersion} vs actual v${db.verno}). ` +
                `Algunos campos podrían perderse. ¿Continuar de todas formas?`
            );
            if (!cont) return;
        }

        // Una sola transacción sobre todas las tablas: si algo falla, revierte todo.
        await db.transaction('rw', db.tables, async () => {
            for (const table of db.tables) {
                await table.clear();
                const rows = dump.tables[table.name];
                if (Array.isArray(rows) && rows.length > 0) {
                    await table.bulkAdd(rows);
                }
            }
        });

        showToast('Backup restaurado. Recargando app...', 'success', 2000);
        // Recargar full: variables en memoria (allProducts, currentEvent, etc.)
        // están desincronizadas con la DB nueva.
        setTimeout(() => location.reload(), 1500);

    } catch (err) {
        console.error('Error importando backup:', err);
        showToast('Error al importar backup. Revisa consola.', 'error', 4000);
    }
}

document.getElementById('btn-export-backup').onclick = exportBackup;
document.getElementById('btn-import-backup').onclick = () => {
    document.getElementById('backup-file-input').click();
};
document.getElementById('backup-file-input').onchange = (e) => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = ''; // Reset para permitir re-seleccionar el mismo archivo
};

// Config Management
document.getElementById('config-form').onsubmit = async (e) => {
    e.preventDefault();
    const posnet = parseFloat(document.getElementById('config-posnet-fee').value);
    const nombre = document.getElementById('config-business-name').value;
    
    appConfig.porcentaje_comision_posnet = posnet;
    appConfig.nombre_negocio = nombre;
    
    await db.configuracion.update(1, {
        porcentaje_comision_posnet: posnet,
        nombre_negocio: nombre
    });
    showToast('Configuración guardada.', 'success');
};

// ==========================================
// HISTORY / EXPORT VIEW
// ==========================================
async function loadHistoryView() {
    const select = document.getElementById('history-event-select');
    select.innerHTML = '<option value="">Seleccione un evento</option>';
    
    const events = await db.evento.reverse().toArray();
    events.forEach(ev => {
        const opt = document.createElement('option');
        opt.value = ev.id;
        opt.textContent = `${ev.nombre} - ${new Date(ev.fecha_inicio).toLocaleDateString()}`;
        select.appendChild(opt);
    });
    
    select.onchange = async () => {
        const btnExcel = document.getElementById('btn-export-excel');
        const btnWhats = document.getElementById('btn-share-whatsapp');

        if (!select.value) {
            document.getElementById('history-stats').innerHTML = '';
            document.getElementById('history-orders').innerHTML = '';
            btnExcel.disabled = true;
            btnWhats.disabled = true;
            return;
        }

        const evId = parseInt(select.value);
        await renderHistoryStats(evId);
        btnExcel.disabled = false;
        btnWhats.disabled = false;
        btnExcel.onclick = () => exportToExcel(evId);
        btnWhats.onclick = () => shareEventoWhatsApp(evId);
    };
}

// Arma un resumen de texto plano del evento y lo abre en WhatsApp.
// Usa wa.me/?text=... para que el usuario elija el destinatario.
async function shareEventoWhatsApp(eventoId) {
    try {
        const ev = await db.evento.get(eventoId);
        if (!ev) return;

        const pedidos = await db.pedido.where('evento_id').equals(eventoId).toArray();
        const costos = await db.costo_extra.where('evento_id').equals(eventoId).toArray();
        const pedidoIds = pedidos.map(p => p.id);
        const detalles = pedidoIds.length
            ? await db.detalle_pedido.where('pedido_id').anyOf(pedidoIds).toArray()
            : [];
        const stock = await getStockEvento(eventoId);

        const totalBruto = pedidos.reduce((acc, p) => acc + p.total_bruto, 0);
        const totalNeto = pedidos.reduce((acc, p) => acc + p.total_neto, 0);
        const totalCostos = costos.reduce((acc, c) => acc + c.monto, 0);
        const totalCostosUnit = detalles.reduce((acc, d) => acc + (d.costo_unitario_historico || 0) * d.cantidad, 0);
        const beneficioReal = totalNeto - totalCostos - totalCostosUnit;

        // Top 3 productos
        const conteo = new Map();
        detalles.forEach(d => {
            conteo.set(d.nombre_producto_historico, (conteo.get(d.nombre_producto_historico) || 0) + d.cantidad);
        });
        const top = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

        // Construyo texto con saltos de línea reales (\n).
        // WhatsApp respeta *negrita* y _itálica_.
        let txt = `*Resumen ${ev.nombre}*\n`;
        txt += `${new Date(ev.fecha_inicio).toLocaleDateString()}${ev.lugar ? ' · ' + ev.lugar : ''}\n\n`;
        txt += `💰 *Bruto:* ${formatCurrency(totalBruto)}\n`;
        txt += `💵 *Neto:* ${formatCurrency(totalNeto)}\n`;
        txt += `📋 *Pedidos:* ${pedidos.length}\n`;
        txt += `📉 *Costos evento:* ${formatCurrency(totalCostos)}\n`;
        txt += `📊 *Beneficio real:* ${formatCurrency(beneficioReal)}\n`;

        if (stock && stock.totalCargado > 0) {
            txt += `\n🥔 *Papa:* ${stock.consumido.toFixed(2)} kg vendidos / ${stock.totalCargado.toFixed(2)} kg cargados`;
            if (stock.restante > 0) txt += ` (sobraron ${stock.restante.toFixed(2)} kg)`;
            txt += `\n`;
        }

        if (top.length > 0) {
            txt += `\n🏆 *Más vendidos:*\n`;
            top.forEach(([nombre, cant], i) => {
                txt += `${i + 1}. ${nombre} — ${cant}\n`;
            });
        }

        const url = `https://wa.me/?text=${encodeURIComponent(txt)}`;
        window.open(url, '_blank');
    } catch (err) {
        console.error('Error armando WhatsApp:', err);
        showToast('No se pudo armar el resumen.', 'error');
    }
}

async function renderHistoryStats(eventId) {
    const evento = await db.evento.get(eventId);
    const pedidos = await db.pedido.where('evento_id').equals(eventId).toArray();
    const costos = await db.costo_extra.where('evento_id').equals(eventId).toArray();
    const pedidoIds = pedidos.map(p => p.id);
    const detalles = pedidoIds.length
        ? await db.detalle_pedido.where('pedido_id').anyOf(pedidoIds).toArray()
        : [];
    const stock = await getStockEvento(eventId);

    let totalBruto = 0;
    let totalNetoVentas = 0;
    let totalCostosExtras = 0;
    let totalCostosUnitarios = 0;
    let cantPosnet = 0, cantEfectivo = 0, cantTransf = 0;

    // Desglose por producto y por tipo de bebida
    const productosVendidos = new Map(); // nombre -> cantidad total
    const bebidasVendidas = new Map();   // tipo de bebida -> cantidad total

    pedidos.forEach(p => {
        totalBruto += p.total_bruto;
        totalNetoVentas += p.total_neto;
        if (p.medio_pago === 'posnet') cantPosnet++;
        else if (p.medio_pago === 'efectivo') cantEfectivo++;
        else cantTransf++;
    });

    costos.forEach(c => {
        totalCostosExtras += c.monto;
    });

    detalles.forEach(d => {
        totalCostosUnitarios += (d.costo_unitario_historico || 0) * d.cantidad;

        // Agregar al desglose de productos
        const nombre = d.nombre_producto_historico;
        productosVendidos.set(nombre, (productosVendidos.get(nombre) || 0) + d.cantidad);

        // Si trae bebidas elegidas (Bebidas o Promos), desglosarlas por tipo
        if (d.bebida_elegida) {
            const drinks = d.bebida_elegida.split(',').map(s => s.trim()).filter(Boolean);
            drinks.forEach(drink => {
                bebidasVendidas.set(drink, (bebidasVendidas.get(drink) || 0) + d.cantidad);
            });
        }
    });

    const beneficioNominal = totalNetoVentas - totalCostosExtras;
    const beneficioReal = beneficioNominal - totalCostosUnitarios;

    const cardStyle = 'background:var(--bg-card); padding: 20px; border-radius: var(--radius-md); flex: 1; min-width: 180px;';
    const highlightStyle = 'background:var(--bg-card); padding: 20px; border-radius: var(--radius-md); flex: 1; min-width: 220px; border: 2px solid var(--success);';

    const container = document.getElementById('history-stats');
    container.innerHTML = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 20px;">
            <div style="${cardStyle}">
                <h4>Facturación Bruta</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--primary)">${formatCurrency(totalBruto)}</div>
            </div>
            <div style="${cardStyle}">
                <h4>Ingresos Netos</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--primary)">${formatCurrency(totalNetoVentas)}</div>
                <small style="color: var(--text-secondary);">Post-comisión posnet</small>
            </div>
            <div style="${cardStyle}">
                <h4>Costos del Evento</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--danger)">${formatCurrency(totalCostosExtras)}</div>
            </div>
            <div style="${cardStyle}">
                <h4>Costos Unitarios</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--danger)">${formatCurrency(totalCostosUnitarios)}</div>
                <small style="color: var(--text-secondary);">Costo de productos vendidos</small>
            </div>
            <div style="${cardStyle}">
                <h4>Pedidos Totales</h4>
                <div style="font-size: 28px; font-weight: bold;">${pedidos.length}</div>
            </div>
        </div>
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 30px;">
            <div style="${highlightStyle}">
                <h4>Beneficio Nominal</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--success)">${formatCurrency(beneficioNominal)}</div>
                <small style="color: var(--text-secondary);">Ingresos Netos − Costos del Evento</small>
            </div>
            <div style="${highlightStyle}">
                <h4>Beneficio Real</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--success)">${formatCurrency(beneficioReal)}</div>
                <small style="color: var(--text-secondary);">Beneficio Nominal − Costos Unitarios</small>
            </div>
        </div>
        <div style="margin-bottom: 20px;">
            <h4>Medios de Pago utilizados</h4>
            <ul>
                <li>Efectivo: ${cantEfectivo}</li>
                <li>Transferencia: ${cantTransf}</li>
                <li>Posnet: ${cantPosnet}</li>
            </ul>
        </div>
        ${renderStockSection(stock)}
        ${renderCajaSection(evento, cantEfectivo > 0 ? pedidos.filter(p => p.medio_pago === 'efectivo').reduce((acc, p) => acc + p.total_bruto, 0) : 0)}
        ${renderHourlyChart(pedidos)}
        ${renderTopRevenueChart(detalles)}
        ${renderBreakdownSection('Productos Vendidos', productosVendidos, 'No se vendieron productos.')}
        ${renderBreakdownSection('Bebidas Vendidas (por tipo)', bebidasVendidas, 'No se vendieron bebidas en este evento.')}
    `;

    // Podriamos mostrar los ultimos 10 pedios aca, pero con esto es suficiente para el prototipo rapido de UI.
}

function renderStockSection(stock) {
    if (!stock || stock.totalCargado === 0) return '';
    const sobrante = stock.restante;
    const colorSobrante = sobrante < 0 ? 'var(--danger)' : 'var(--success)';
    return `
        <div style="background: var(--bg-card); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <h4 style="margin-bottom: 12px;">🥔 Stock de papa</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; font-size: 14px;">
                <div><small style="color: var(--text-secondary);">Inicial</small><br><strong>${stock.inicial.toFixed(2)} kg</strong></div>
                <div><small style="color: var(--text-secondary);">Repuesto</small><br><strong>${stock.repuesto.toFixed(2)} kg</strong></div>
                <div><small style="color: var(--text-secondary);">Cargado total</small><br><strong>${stock.totalCargado.toFixed(2)} kg</strong></div>
                <div><small style="color: var(--text-secondary);">Vendido (crudos eq.)</small><br><strong>${stock.consumido.toFixed(2)} kg</strong></div>
                <div><small style="color: var(--text-secondary);">Sobrante / faltante</small><br><strong style="color: ${colorSobrante};">${sobrante.toFixed(2)} kg</strong></div>
            </div>
        </div>
    `;
}

function renderCajaSection(evento, ventasEfectivo) {
    if (!evento) return '';
    const inicial = evento.efectivo_inicial || 0;
    const final = evento.efectivo_final;
    const esperado = inicial + ventasEfectivo;

    if (inicial === 0 && final === null) return ''; // No se trackeó caja en este evento

    let cierreHTML = '';
    if (final !== null && final !== undefined) {
        const diff = final - esperado;
        const diffColor = Math.abs(diff) < 1 ? 'var(--success)' : (diff < 0 ? 'var(--danger)' : 'var(--warning)');
        const diffLabel = diff > 0 ? 'Sobrante' : (diff < 0 ? 'Faltante' : 'Cuadra');
        cierreHTML = `
            <div><small style="color: var(--text-secondary);">Contado al cerrar</small><br><strong>${formatCurrency(final)}</strong></div>
            <div><small style="color: var(--text-secondary);">${diffLabel}</small><br><strong style="color: ${diffColor};">${formatCurrency(Math.abs(diff))}</strong></div>
        `;
    } else {
        cierreHTML = `<div style="grid-column: 1/-1; color: var(--text-secondary); font-style: italic;">Caja aún no cerrada.</div>`;
    }

    return `
        <div style="background: var(--bg-card); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <h4 style="margin-bottom: 12px;">💵 Cierre de caja (efectivo)</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; font-size: 14px;">
                <div><small style="color: var(--text-secondary);">Caja inicial</small><br><strong>${formatCurrency(inicial)}</strong></div>
                <div><small style="color: var(--text-secondary);">Ventas en efectivo</small><br><strong>${formatCurrency(ventasEfectivo)}</strong></div>
                <div><small style="color: var(--text-secondary);">Esperado al cerrar</small><br><strong>${formatCurrency(esperado)}</strong></div>
                ${cierreHTML}
            </div>
        </div>
    `;
}

// Gráfico de barras: facturación bruta por hora del día.
// Identifica horas pico para planificar producción.
function renderHourlyChart(pedidos) {
    if (pedidos.length === 0) return '';

    // Agrupo por hora (0-23). Sumo total_bruto por hora.
    const porHora = new Array(24).fill(0);
    pedidos.forEach(p => {
        const h = new Date(p.fecha_hora).getHours();
        porHora[h] += p.total_bruto;
    });

    // Recorto a las horas con actividad para no mostrar 24h vacías.
    const horasConVentas = porHora
        .map((v, h) => ({ h, v }))
        .filter(x => x.v > 0);

    if (horasConVentas.length === 0) return '';

    const minH = horasConVentas[0].h;
    const maxH = horasConVentas[horasConVentas.length - 1].h;
    const rango = [];
    for (let h = minH; h <= maxH; h++) rango.push({ h, v: porHora[h] });

    const max = Math.max(...rango.map(x => x.v));
    const w = 100; // viewBox units por barra
    const totalW = w * rango.length;
    const h = 200;
    const padBottom = 30;
    const padTop = 20;

    const bars = rango.map((x, i) => {
        const barH = max > 0 ? ((x.v / max) * (h - padBottom - padTop)) : 0;
        const y = h - padBottom - barH;
        const xPos = i * w + 10;
        const barW = w - 20;
        const color = x.v > 0 ? 'var(--primary)' : 'var(--bg-card)';
        return `
            <rect x="${xPos}" y="${y}" width="${barW}" height="${barH}"
                  fill="${color}" rx="4">
                <title>${x.h}:00 — ${formatCurrency(x.v)}</title>
            </rect>
            <text x="${xPos + barW/2}" y="${h - padBottom + 18}"
                  fill="var(--text-secondary)" font-size="14" text-anchor="middle">${x.h}h</text>
            ${x.v > 0 ? `<text x="${xPos + barW/2}" y="${y - 6}" fill="var(--text-primary)" font-size="12" text-anchor="middle" font-weight="600">${Math.round(x.v/1000)}k</text>` : ''}
        `;
    }).join('');

    return `
        <div style="background: var(--bg-card); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <h4 style="margin-bottom: 12px;">📈 Facturación por hora</h4>
            <div style="overflow-x: auto;">
                <svg viewBox="0 0 ${totalW} ${h}" style="width: 100%; min-width: ${rango.length * 50}px; height: ${h}px; display: block;" preserveAspectRatio="none">
                    ${bars}
                </svg>
            </div>
            <small style="color: var(--text-secondary); display: block; margin-top: 8px;">Pasá el mouse por las barras para ver el monto exacto.</small>
        </div>
    `;
}

// Gráfico horizontal: top 5 productos por facturación (no por cantidad).
function renderTopRevenueChart(detalles) {
    if (detalles.length === 0) return '';

    const porProducto = new Map();
    detalles.forEach(d => {
        porProducto.set(d.nombre_producto_historico, (porProducto.get(d.nombre_producto_historico) || 0) + d.subtotal);
    });

    const top = [...porProducto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length === 0) return '';
    const max = top[0][1];

    const filas = top.map(([nombre, total], i) => {
        const pct = max > 0 ? (total / max) * 100 : 0;
        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 13px;">
                    <span><strong>#${i + 1}</strong> ${nombre}</span>
                    <span style="color: var(--success); font-weight: 700;">${formatCurrency(total)}</span>
                </div>
                <div style="background: var(--bg-darker); height: 12px; border-radius: 6px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, var(--primary), var(--success)); width: ${pct}%; height: 100%; border-radius: 6px;"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div style="background: var(--bg-card); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <h4 style="margin-bottom: 12px;">🏆 Top 5 por facturación</h4>
            ${filas}
        </div>
    `;
}

function renderBreakdownSection(titulo, mapa, mensajeVacio) {
    const total = Array.from(mapa.values()).reduce((acc, n) => acc + n, 0);
    const filas = Array.from(mapa.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([nombre, cant]) => {
            const pct = total > 0 ? Math.round((cant / total) * 100) : 0;
            return `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--bg-card);">
                    <span style="font-weight: 500;">${nombre}</span>
                    <span style="display: flex; align-items: center; gap: 12px;">
                        <small style="color: var(--text-secondary);">${pct}%</small>
                        <span style="font-weight: 700; color: var(--primary); min-width: 40px; text-align: right;">${cant}</span>
                    </span>
                </div>
            `;
        })
        .join('');

    const contenido = mapa.size === 0
        ? `<p style="color: var(--text-secondary);">${mensajeVacio}</p>`
        : filas;

    return `
        <div style="background: var(--bg-card); padding: 20px; border-radius: var(--radius-md); margin-bottom: 20px;">
            <h4 style="margin-bottom: 10px;">${titulo} <small style="color: var(--text-secondary); font-weight: 400;">(${total} unidades)</small></h4>
            ${contenido}
        </div>
    `;
}

async function exportToExcel(eventId) {
    try {
        const evt = await db.evento.get(eventId);
        const pedidos = await db.pedido.where('evento_id').equals(eventId).toArray();
        
        if (pedidos.length === 0) {
            showToast('No hay pedidos para este evento.', 'warning');
            return;
        }

        const wb = XLSX.utils.book_new();

        // Hoja 1: Resumen de Ventas
        const datosResumen = pedidos.map(p => ({
            'ID Pedido': p.numero_pedido || p.id,
            'Fecha y Hora': new Date(p.fecha_hora).toLocaleString(),
            'Medio de Pago': p.medio_pago,
            'Total Bruto': p.total_bruto,
            'Comisión Posnet': p.comision_posnet || 0,
            'Total Neto': p.total_neto,
            'Estado': p.estado
        }));
        
        const wsResumen = XLSX.utils.json_to_sheet(datosResumen);
        XLSX.utils.book_append_sheet(wb, wsResumen, "Pedidos");

        // Hoja 2 + Sum calculations
        let detallesEx = [];
        let totalGramosVendidos = 0;
        let totalBruto = 0;
        let totalNetoVentas = 0;
        let totalCostosUnitarios = 0;

        for (let p of pedidos) {
            totalBruto += p.total_bruto;
            totalNetoVentas += p.total_neto;

            const dets = await db.detalle_pedido.where('pedido_id').equals(p.id).toArray();
            for (let d of dets) {
                const gramosTotales = d.gramaje_historico * d.cantidad;
                totalGramosVendidos += gramosTotales;
                const costoLinea = (d.costo_unitario_historico || 0) * d.cantidad;
                totalCostosUnitarios += costoLinea;

                detallesEx.push({
                    'ID Pedido': p.numero_pedido || p.id,
                    'Producto': d.nombre_producto_historico,
                    'Cantidad': d.cantidad,
                    'Precio Unitario': d.precio_unitario_historico,
                    'Subtotal': d.subtotal,
                    'Costo Unitario': d.costo_unitario_historico || 0,
                    'Costo Total Línea': costoLinea,
                    'Gramos Papa / Unidad': d.gramaje_historico,
                    'Gramos Totales': gramosTotales,
                    'Bebidas de promo': d.bebida_elegida || ''
                });
            }
        }

        const wsDetalles = XLSX.utils.json_to_sheet(detallesEx);
        XLSX.utils.book_append_sheet(wb, wsDetalles, "Detalles de Venta");

        // Hoja 3: Resumen del Día
        const costos = await db.costo_extra.where('evento_id').equals(eventId).toArray();
        let totalCostosExtras = 0;
        costos.forEach(c => totalCostosExtras += c.monto);

        const kilosVendidos = totalGramosVendidos / 1000;
        const beneficioNominal = totalNetoVentas - totalCostosExtras;
        const beneficioReal = beneficioNominal - totalCostosUnitarios;

        const datosResumenDia = [{
            'Facturación Bruta del Día': totalBruto,
            'Ingresos Netos (Post-Posnet)': totalNetoVentas,
            'Costos del Evento': totalCostosExtras,
            'Costos Unitarios Totales': totalCostosUnitarios,
            'Beneficio Nominal': beneficioNominal,
            'Beneficio Real': beneficioReal,
            'Kilos de Papa Vendidos': kilosVendidos
        }];

        const wsResumenDia = XLSX.utils.json_to_sheet(datosResumenDia);
        XLSX.utils.book_append_sheet(wb, wsResumenDia, "Resumen del Día");

        // Download
        XLSX.writeFile(wb, `Reporte_CRINK_${evt.nombre.replace(/\s+/g, '_')}.xlsx`);

    } catch (e) {
        console.error("Error exporting excel:", e);
        showToast('Error al exportar. Revisa consola.', 'error', 4000);
    }
}
