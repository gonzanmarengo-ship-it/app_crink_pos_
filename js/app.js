// --- Global State ---
let currentEvent = null;
let appConfig = null;
let cart = []; // Array of { product, quantity, subtotal }
let allProducts = []; // Para el panel POS

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
}

// --- Formatting Helpers ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount);
};

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
        }
    });

    // Payment Modal Cancel
    document.getElementById('cancel-payment').addEventListener('click', () => {
        document.getElementById('payment-modal').classList.remove('active');
    });

    // Drink Selection Modal
    document.getElementById('cancel-drink-selection').addEventListener('click', () => {
        document.getElementById('drink-selection-modal').classList.remove('active');
    });

    // Drink Selection Modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        if(btn.id === 'close-drink-modal') {
             btn.addEventListener('click', () => {
                 document.getElementById('drink-selection-modal').classList.remove('active');
                 pendingProductForDrink = null;
                 pendingDrinksSelected = [];
                 pendingDrinksRequired = 0;
             });
        }
    });

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
    renderPOSProducts();
    renderCart(); // Limpiar rastro de carrito viejo si lo hubiera
}

function renderPOSProducts() {
    const grid = document.getElementById('pos-products-grid');
    grid.innerHTML = '';
    
    allProducts.forEach(prod => {
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

function handleProductClick(product) {
    if (!currentEvent) return alert("Debes iniciar un evento primero.");
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
                    // Join selected drinks with a comma and space
                    const selectedDrinksString = pendingDrinksSelected.join(', ');
                    addToCart(productWithDrink, selectedDrinksString);
                    
                    // Reset pending state
                    pendingProductForDrink = null;
                    pendingDrinksSelected = [];
                    pendingDrinksRequired = 0;
                    document.getElementById('drink-selection-modal').classList.remove('active');
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
    if (!currentEvent) return alert("Debes iniciar un evento primero.");
    
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
             
             // Count for unique order number today (simplified)
             const pedidosHoy = await db.pedido.where('evento_id').equals(currentEvent.id).count();
             
             const pedidoId = await db.pedido.add({
                 numero_pedido: pedidosHoy + 1,
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
         document.getElementById('payment-modal').classList.remove('active');
         
         // Visual feedback could be added here
         
     } catch (err) {
         console.error("Error validando pedido: ", err);
         alert("Hubo un error al procesar el pago.");
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
    
    // Bind close/open events
    document.querySelectorAll('.close-ev-btn').forEach(btn => {
        btn.onclick = async () => toggleEventStatus(parseInt(btn.dataset.id), 'finalizado');
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
                    alert("Hubo un error al eliminar el evento.");
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
    alert('Costo agregado exitosamente.');
};

async function openEventDetailsModal(eventId) {
    const evt = await db.evento.get(eventId);
    if (!evt) return;

    document.getElementById('event-details-title').textContent = `Costos: ${evt.nombre}`;
    document.getElementById('detail-cost-form').reset();
    document.getElementById('detail-cost-evento-id').value = eventId;
    
    await renderEventCosts(eventId);

    document.getElementById('event-details-modal').classList.add('active');
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
            item.style.padding = '8px 0';
            item.style.borderBottom = '1px solid var(--border)';
            item.innerHTML = `
                <span>${c.descripcion}</span>
                <span style="font-weight: 500;">${formatCurrency(c.monto)}</span>
            `;
            listContainer.appendChild(item);
        });
    }

    totalContainer.textContent = `Total: ${formatCurrency(total)}`;
}

document.getElementById('detail-cost-form').onsubmit = async (e) => {
    e.preventDefault();
    const eventId = parseInt(document.getElementById('detail-cost-evento-id').value);
    const monto = parseFloat(document.getElementById('detail-cost-monto').value);
    const desc = document.getElementById('detail-cost-desc').value;

    await db.costo_extra.add({
        evento_id: eventId,
        fecha: new Date(),
        monto: monto,
        descripcion: desc
    });

    document.getElementById('detail-cost-form').reset();
    await renderEventCosts(eventId); // Refresh list immediately
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
    document.getElementById('event-modal-title').textContent = 'Nuevo Evento';
    document.getElementById('event-modal').classList.add('active');
};

document.getElementById('event-form').onsubmit = async (e) => {
    e.preventDefault();
    
    // Auto-close any active event before opening another one
    const activos = await db.evento.where('estado').equals('activo').toArray();
    for (let eq of activos) {
        await db.evento.update(eq.id, { estado: 'finalizado' });
    }
    
    const id = document.getElementById('ev-id').value;
    const data = {
        nombre: document.getElementById('ev-nombre').value,
        lugar: document.getElementById('ev-lugar').value,
        observaciones: document.getElementById('ev-obs').value,
        fecha_inicio: new Date()
    };
    
    if (id) {
        await db.evento.update(parseInt(id), data);
    } else {
        data.estado = 'activo';
        await db.evento.add(data);
    }
    
    document.getElementById('event-modal').classList.remove('active');
    renderEventsList();
    updateEventStatus();
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
    alert("Configuración Guardada.");
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
        if (!select.value) {
            document.getElementById('history-stats').innerHTML = '';
            document.getElementById('history-orders').innerHTML = '';
            document.getElementById('btn-export-excel').disabled = true;
            return;
        }
        
        await renderHistoryStats(parseInt(select.value));
        document.getElementById('btn-export-excel').disabled = false;
        document.getElementById('btn-export-excel').onclick = () => exportToExcel(parseInt(select.value));
    };
}

async function renderHistoryStats(eventId) {
    const pedidos = await db.pedido.where('evento_id').equals(eventId).toArray();
    const costos = await db.costo_extra.where('evento_id').equals(eventId).toArray();
    
    let totalBruto = 0;
    let totalNetoVentas = 0;
    let totalCostosExtras = 0;
    let cantPosnet = 0, cantEfectivo = 0, cantTransf = 0;
    
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

    const totalNetoAjustado = totalNetoVentas - totalCostosExtras;
    
    const container = document.getElementById('history-stats');
    container.innerHTML = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 30px;">
            <div style="background:var(--bg-card); padding: 20px; border-radius: var(--radius-md); flex: 1;">
                <h4>Facturación Bruta</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--primary)">${formatCurrency(totalBruto)}</div>
            </div>
            <div style="background:var(--bg-card); padding: 20px; border-radius: var(--radius-md); flex: 1;">
                <h4>Costos Extra</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--danger)">${formatCurrency(totalCostosExtras)}</div>
            </div>
            <div style="background:var(--bg-card); padding: 20px; border-radius: var(--radius-md); flex: 1;">
                <h4>Facturación Neta</h4>
                <div style="font-size: 28px; font-weight: bold; color: var(--success)">${formatCurrency(totalNetoAjustado)}</div>
            </div>
            <div style="background:var(--bg-card); padding: 20px; border-radius: var(--radius-md); flex: 1;">
                <h4>Pedidos Totales</h4>
                <div style="font-size: 28px; font-weight: bold;">${pedidos.length}</div>
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
    `;
    
    // Podriamos mostrar los ultimos 10 pedios aca, pero con esto es suficiente para el prototipo rapido de UI.
}

async function exportToExcel(eventId) {
    try {
        const evt = await db.evento.get(eventId);
        const pedidos = await db.pedido.where('evento_id').equals(eventId).toArray();
        
        if (pedidos.length === 0) {
            alert("No hay pedidos para este evento.");
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

        for (let p of pedidos) {
            totalBruto += p.total_bruto;
            totalNetoVentas += p.total_neto;

            const dets = await db.detalle_pedido.where('pedido_id').equals(p.id).toArray();
            for (let d of dets) {
                const gramosTotales = d.gramaje_historico * d.cantidad;
                totalGramosVendidos += gramosTotales;

                detallesEx.push({
                    'ID Pedido': p.numero_pedido || p.id,
                    'Producto': d.nombre_producto_historico,
                    'Cantidad': d.cantidad,
                    'Precio Unitario': d.precio_unitario_historico,
                    'Subtotal': d.subtotal,
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
        const totalNetoFinal = totalNetoVentas - totalCostosExtras;

        const datosResumenDia = [{
            'Facturación Bruta del Día': totalBruto,
            'Facturación Neta del Día (Sin Costos)': totalNetoVentas,
            'Costos del Día': totalCostosExtras,
            'Facturación Neta Final': totalNetoFinal,
            'Kilos de Papa Vendidos': kilosVendidos
        }];

        const wsResumenDia = XLSX.utils.json_to_sheet(datosResumenDia);
        XLSX.utils.book_append_sheet(wb, wsResumenDia, "Resumen del Día");

        // Download
        XLSX.writeFile(wb, `Reporte_CRINK_${evt.nombre.replace(/\s+/g, '_')}.xlsx`);

    } catch (e) {
        console.error("Error exporting excel:", e);
        alert("Error al exportar. Revisa consola.");
    }
}
