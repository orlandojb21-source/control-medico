// ═══════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════
let pacientes = [];
let atenciones = [];
let appRecords = [];
let currentReportTab = 'semanal';
let reportWeekOffset = 0;
let reportMonthOffset = 0;
let reportPacienteID = '';
let reportIngresosMode = 'mensual';
let reportIngresosOffset = 0;

let session = null; // {idToken, email, rol, nombre}
let doctorSeleccionado = '';
let doctoresActivos = [];
let editandoPacienteId = null;
let editandoAtencionId = null;
let pacienteDetailActualId = null;

const API_URL = "https://script.google.com/macros/s/AKfycbzXyH8x1jvetnlkilUkIGBgCn3hl1jCTj5XLehYGeofZp7E1yOhmuxaDy-UZf-xAg84/exec";
const OAUTH_CLIENT_ID = "70107180107-9mk581fsuvm7fctg3lr231nb208h91ou.apps.googleusercontent.com";

// ═══════════════════════════════════════
// UTILIDADES DE SEGURIDAD
// ═══════════════════════════════════════
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function arrayBufferToBase64(buf) {
  var bytes = new Uint8Array(buf);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToArrayBuffer(b64) {
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function decodeJwt(token) {
  try {
    var payload = token.split('.')[1];
    var json = decodeURIComponent(atob(payload.replace(/-/g, '+').replace(/_/g, '/')).split('').map(function (c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(json);
  } catch (e) { return null; }
}

// ═══════════════════════════════════════
// AUTENTICACION (Google Sign-In)
// ═══════════════════════════════════════
function apiCall(action, params) {
  params = params || {};
  var payload = Object.assign({ action: action, idToken: session ? session.idToken : '' }, params);
  if (session && session.rol === 'Admin' && doctorSeleccionado && !payload.hasOwnProperty('doctorEmail')) {
    payload.doctorEmail = doctorSeleccionado;
  }
  return fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (!json.success && json.code === 'AUTH_INVALID') {
        cerrarSesion();
        showToast('⚠ Tu sesión expiró, inicia sesión de nuevo');
      }
      return json;
    })
    .catch(function () {
      return { success: false, error: 'Error de conexión' };
    });
}

function mostrarLogin(mensaje) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('pantallaLogin').style.display = 'flex';
  document.getElementById('gsiButton').style.display = '';
  var err = document.getElementById('loginError');
  if (mensaje) { err.textContent = mensaje; err.style.display = 'block'; }
  else { err.style.display = 'none'; }
}

function mostrarSinAcceso(mensaje) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('pantallaLogin').style.display = 'flex';
  document.getElementById('gsiButton').style.display = 'none';
  var err = document.getElementById('loginError');
  err.innerHTML = esc(mensaje || 'No tienes acceso a esta aplicación') +
    '<br><br><button onclick="cerrarSesion()">Usar otra cuenta</button>';
  err.style.display = 'block';
}

function cerrarSesion() {
  session = null;
  doctorSeleccionado = '';
  localStorage.removeItem('cm_session');
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  mostrarLogin();
}

function initGoogleSignIn() {
  if (!window.google || !google.accounts || !google.accounts.id) { setTimeout(initGoogleSignIn, 300); return; }
  google.accounts.id.initialize({
    client_id: OAUTH_CLIENT_ID,
    callback: onGoogleCredential
  });
  google.accounts.id.renderButton(document.getElementById('gsiButton'), { theme: 'filled_blue', size: 'large', width: 280, text: 'signin_with', locale: 'es' });
}

function onGoogleCredential(resp) {
  var payload = decodeJwt(resp.credential);
  if (!payload) { mostrarLogin('No se pudo procesar el inicio de sesión'); return; }
  session = { idToken: resp.credential, email: payload.email, nombre: payload.name || payload.email, rol: null };
  confirmarSesion();
}

function confirmarSesion() {
  apiCall('whoAmI', {}).then(function (json) {
    if (!json.success) {
      if (json.code === 'AUTH_FORBIDDEN') mostrarSinAcceso(json.error);
      else mostrarLogin(json.error || 'No se pudo iniciar sesión');
      return;
    }
    session.rol = json.rol;
    session.nombre = json.nombre || session.nombre;
    iniciarApp();
  });
}

function iniciarApp() {
  document.getElementById('pantallaLogin').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('headerUserName').textContent = session.nombre || session.email;

  var switchWrap = document.getElementById('doctorSwitchWrap');
  if (session.rol === 'Admin') {
    switchWrap.style.display = 'block';
    apiCall('getDoctores', {}).then(function (json) {
      doctoresActivos = json.success ? json.data : [];
      var sel = document.getElementById('doctorSwitchSelect');
      sel.innerHTML = '<option value="">— Selecciona un doctor —</option>' +
        doctoresActivos.map(function (d) { return '<option value="' + esc(d.email) + '">' + esc(d.nombre) + '</option>'; }).join('');
      if (doctoresActivos.length === 1) {
        sel.value = doctoresActivos[0].email;
        onCambiarDoctor();
      }
    });
  } else {
    switchWrap.style.display = 'none';
    doctorSeleccionado = '';
    arrancarDatos();
  }

  ofrecerBiometrico();
}

function onCambiarDoctor() {
  doctorSeleccionado = document.getElementById('doctorSwitchSelect').value;
  if (!doctorSeleccionado) {
    pacientes = []; atenciones = []; appRecords = [];
    renderPacientes(); renderHoy(); renderReportes(); populatePacienteSelect();
    return;
  }
  arrancarDatos();
}

function arrancarDatos() {
  setHeaderDate();
  initRegistroDefaults();
  showToast('Cargando datos...');
  loadAll().then(function () {
    renderReportes();
    showToast('✓ Datos cargados');
  });
}

// ═══════════════════════════════════════
// BIOMETRICO — desbloqueo local de comodidad, no reemplaza el login de Google
// ═══════════════════════════════════════
function soportaBiometrico() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

function ofrecerBiometrico() {
  if (!soportaBiometrico()) return;
  if (localStorage.getItem('cm_bio_cred')) return;
  if (sessionStorage.getItem('cm_bio_dismissed')) return;
  var banner = document.getElementById('bioBanner');
  if (banner) banner.style.display = 'flex';
}

function activarBiometrico() {
  var challenge = crypto.getRandomValues(new Uint8Array(32));
  var userId = crypto.getRandomValues(new Uint8Array(16));
  navigator.credentials.create({
    publicKey: {
      challenge: challenge,
      rp: { name: 'Control Médico' },
      user: { id: userId, name: session.email, displayName: session.nombre || session.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000
    }
  }).then(function (cred) {
    localStorage.setItem('cm_bio_cred', arrayBufferToBase64(cred.rawId));
    localStorage.setItem('cm_session', JSON.stringify(session));
    document.getElementById('bioBanner').style.display = 'none';
    showToast('✓ Desbloqueo por huella/Face ID activado');
  }).catch(function (err) {
    showToast('No se pudo activar (' + (err.name || 'error') + ')');
  });
}

function descartarBiometrico() {
  sessionStorage.setItem('cm_bio_dismissed', '1');
  document.getElementById('bioBanner').style.display = 'none';
}

function intentarDesbloqueoLocal() {
  var credId = localStorage.getItem('cm_bio_cred');
  var savedSession = localStorage.getItem('cm_session');
  if (!credId || !savedSession || !soportaBiometrico()) return Promise.resolve(false);

  var challenge = crypto.getRandomValues(new Uint8Array(32));
  return navigator.credentials.get({
    publicKey: {
      challenge: challenge,
      allowCredentials: [{ id: base64ToArrayBuffer(credId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000
    }
  }).then(function () {
    try { session = JSON.parse(savedSession); } catch (e) { return false; }
    return true;
  }).catch(function () {
    return false;
  });
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
window.onload = function () {
  setHeaderDate();
  initGoogleSignIn();
  intentarDesbloqueoLocal().then(function (ok) {
    if (ok) confirmarSesion();
  });
};

function setHeaderDate() {
  var now = new Date();
  var dias   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  var meses  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var mesesF = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  document.getElementById('headerDate').textContent = dias[now.getDay()] + ' ' + now.getDate() + ' ' + meses[now.getMonth()];
  document.getElementById('hoy-date-str').textContent = dias[now.getDay()] + ', ' + now.getDate() + ' de ' + mesesF[now.getMonth()] + ' ' + now.getFullYear();
}

function initRegistroDefaults() {
  var now = new Date();
  document.getElementById('reg-fecha').value = now.toISOString().split('T')[0];
  var hh = String(now.getHours()).padStart(2,'0');
  var mm = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('reg-hora').value = hh + ':' + mm;
}

// ═══════════════════════════════════════
// CARGA DE DATOS
// ═══════════════════════════════════════
function loadAll() {
  return Promise.all([
    apiCall('getPacientes', {}),
    apiCall('getAtenciones', {}),
    apiCall('getAPP', {})
  ]).then(function (results) {
    pacientes  = results[0].success ? results[0].data : [];
    atenciones = results[1].success ? results[1].data : [];
    appRecords = results[2].success ? results[2].data : [];
    populatePacienteSelect();
    renderPacientes();
    renderHoy();
  }).catch(function () {
    pacientes = []; atenciones = []; appRecords = [];
    showToast('⚠ Sin conexión con el servidor');
  });
}

// ═══════════════════════════════════════
// NAVEGACIÓN
// ═══════════════════════════════════════
function setScreen(name, btn) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('screen-' + name).classList.add('active');
  btn.classList.add('active');
  var subs = {registro:'Nueva atención', hoy:'Atenciones del día', pacientes:'Directorio', reportes:'Estadísticas'};
  document.getElementById('headerSub').textContent = subs[name] || '';
  if (name === 'reportes')  renderReportes();
  if (name === 'hoy')       renderHoy();
  if (name === 'pacientes') renderPacientes();
  if (name === 'registro')  populatePacienteSelect();
}

// ═══════════════════════════════════════
// REGISTRO
// ═══════════════════════════════════════
function populatePacienteSelect() {
  var sel = document.getElementById('reg-paciente');
  var cur = sel.value;
  sel.innerHTML = '<option value="">— Seleccionar paciente —</option>';
  pacientes
    .filter(function(p) { return (p.Estado || 'Activo') === 'Activo'; })
    .sort(function(a,b) { return (a.NombreCompleto||'').localeCompare(b.NombreCompleto||''); })
    .forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.ID;
      opt.textContent = p.NombreCompleto;
      sel.appendChild(opt);
    });
  if (cur) sel.value = cur;
}

function onSelectPaciente() {
  var id = document.getElementById('reg-paciente').value;
  var preview = document.getElementById('reg-preview');
  if (!id) { preview.style.display = 'none'; return; }
  var p = pacientes.find(function(x) { return x.ID === id; });
  if (!p) { preview.style.display = 'none'; return; }
  document.getElementById('prev-nombre').textContent       = p.NombreCompleto || '—';
  document.getElementById('prev-cedula').textContent       = p.Cedula || '—';
  document.getElementById('prev-edad').textContent         = calcEdad(p.FechaNacimiento) || p.Edad || '—';
  document.getElementById('prev-fechanac').textContent     = formatDate(p.FechaNacimiento) || '—';
  document.getElementById('prev-sangre').textContent       = p.TipoSangre || '—';
  document.getElementById('prev-antecedentes').textContent = p.AntecedentesPatologicos || 'Ninguno';
  document.getElementById('prev-alergias').textContent     = p.Alergias || 'Ninguna';
  preview.style.display = 'block';
}

function guardarAtencion() {
  var pacID  = document.getElementById('reg-paciente').value;
  var fecha  = document.getElementById('reg-fecha').value;
  var hora   = document.getElementById('reg-hora').value;
  var tipo   = document.getElementById('reg-tipo').value;
  var precio = document.getElementById('reg-precio').value;
  var estado = document.getElementById('reg-estado').value;
  var motivo      = document.getElementById('reg-motivo').value;
  var tratamiento = document.getElementById('reg-tratamiento').value;
  var obs         = document.getElementById('reg-obs').value;

  if (!pacID) { showToast('⚠ Selecciona un paciente'); return; }
  if (!fecha) { showToast('⚠ Indica la fecha'); return; }
  if (!hora)  { showToast('⚠ Indica la hora'); return; }

  var btn = document.getElementById('btnGuardarAtencion');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  apiCall('registrarAtencion', {
    PacienteID: pacID, Fecha: fecha, Hora: hora,
    Precio: String(Number(precio) || 0), TipoAtencion: tipo,
    MotivoConsulta: motivo, Tratamiento: tratamiento, Observaciones: obs, Estado: estado
  }).then(function (json) {
      if (json.success) {
        showToast('✓ Atención registrada');
        document.getElementById('reg-paciente').value = '';
        document.getElementById('reg-motivo').value   = '';
        document.getElementById('reg-obs').value      = '';
        document.getElementById('reg-tratamiento').value = '';
        document.getElementById('reg-precio').value   = '';
        document.getElementById('reg-preview').style.display = 'none';
        initRegistroDefaults();
        loadAll();
      } else { showToast('✗ ' + (json.error || 'Error al guardar')); }
      btn.disabled = false;
      btn.textContent = 'Guardar Atención';
    });
}

// ═══════════════════════════════════════
// HOY
// ═══════════════════════════════════════
function renderHoy() {
  var now   = new Date();
  var today = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  var cont  = document.getElementById('hoy-lista');

  var todayAten = atenciones.filter(function(a) {
    if (!a.Fecha) return false;
    var d  = new Date(a.Fecha);
    var fy = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    return fy === today;
  });

  document.getElementById('hoy-count').textContent =
    todayAten.length + ' atención' + (todayAten.length !== 1 ? 'es' : '') + ' registrada' + (todayAten.length !== 1 ? 's' : '');

  if (todayAten.length === 0) {
    cont.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>Sin atenciones hoy</p></div>';
    return;
  }

  cont.innerHTML = todayAten
    .sort(function(a,b) { return (a.Hora||'').localeCompare(b.Hora||''); })
    .map(function(a) {
      var pac = pacientes.find(function(p) { return p.ID === a.PacienteID; }) || {};
      return '<div class="atencion-card" onclick="abrirEditarAtencion(\'' + a.ID + '\')"><div class="atencion-top"><div>' +
        '<div class="atencion-name">' + esc(pac.NombreCompleto||'Paciente') + '</div>' +
        '<div class="atencion-meta">Céd. ' + esc(pac.Cedula||'—') + ' · Tel. ' + esc(pac.Telefono||'—') + '</div>' +
        (a.TipoAtencion ? '<div class="atencion-meta" style="margin-top:3px">' + esc(a.TipoAtencion) + '</div>' : '') +
        '</div><div style="text-align:right">' +
        '<span class="status ' + statusClass(a.Estado) + '">' + esc(a.Estado||'—') + '</span>' +
        '<div class="atencion-hora" style="margin-top:5px">' + esc(formatHora(a.Hora)) + '</div>' +
        '</div></div></div>';
    }).join('');
}

// ═══════════════════════════════════════
// PACIENTES
// ═══════════════════════════════════════
function renderPacientes() {
  var q    = (document.getElementById('pac-search') ? document.getElementById('pac-search').value : '').toLowerCase();
  var cont = document.getElementById('pac-lista');
  var filtered = pacientes.filter(function(p) {
    return (p.NombreCompleto||'').toLowerCase().includes(q) || (p.Cedula||'').toLowerCase().includes(q);
  });

  document.getElementById('pac-count').textContent =
    pacientes.length + ' paciente' + (pacientes.length!==1?'s':'') + ' registrado' + (pacientes.length!==1?'s':'');

  if (filtered.length === 0) {
    cont.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>Sin resultados</p></div>';
    return;
  }

  cont.innerHTML = filtered
    .sort(function(a,b) { return (a.NombreCompleto||'').localeCompare(b.NombreCompleto||''); })
    .map(function(p) {
      var edad = calcEdad(p.FechaNacimiento) ? calcEdad(p.FechaNacimiento) + ' años' : (p.Edad||'—');
      return '<div class="card" onclick="openPacienteDetail(\'' + p.ID + '\')" style="cursor:pointer">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start"><div>' +
        '<div class="patient-name">' + esc(p.NombreCompleto||'—') + '</div>' +
        '<div class="patient-sub">Céd. ' + esc(p.Cedula||'—') + ' · Tel. ' + esc(p.Telefono||'—') + '</div>' +
        '</div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b0bec5" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></div>' +
        '<div class="patient-meta">' +
        '<span class="meta-badge">' + esc(edad) + '</span>' +
        (p.TipoSangre ? '<span class="meta-badge">' + esc(p.TipoSangre) + '</span>' : '') +
        '<span class="meta-badge">' + esc(p.Estado||'Activo') + '</span>' +
        '</div></div>';
    }).join('');
}

function abrirModalPaciente(modoEdicion) {
  document.querySelector('#modal-addpac .modal-title').textContent = modoEdicion ? 'Editar Paciente' : 'Nuevo Paciente';
  document.getElementById('btnGuardarPac').textContent = modoEdicion ? 'Guardar Cambios' : 'Guardar Paciente';
  document.getElementById('modal-addpac').classList.add('open');
}

function openAddPaciente() {
  editandoPacienteId = null;
  ['np-nombre','np-cedula','np-fechanac','np-edad','np-telefono','np-direccion','np-antecedentes','np-alergias','np-obs'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('np-sexo').value = '';
  document.getElementById('np-sangre').value = '';
  abrirModalPaciente(false);
}

function abrirEditarPacienteActual() {
  if (!pacienteDetailActualId) return;
  var p = pacientes.find(function(x) { return x.ID === pacienteDetailActualId; });
  if (!p) return;
  editandoPacienteId = pacienteDetailActualId;
  document.getElementById('np-nombre').value = p.NombreCompleto || '';
  document.getElementById('np-cedula').value = p.Cedula || '';
  document.getElementById('np-fechanac').value = p.FechaNacimiento ? String(p.FechaNacimiento).split('T')[0] : '';
  document.getElementById('np-edad').value = p.Edad || '';
  document.getElementById('np-sexo').value = p.Sexo || '';
  document.getElementById('np-sangre').value = p.TipoSangre || '';
  document.getElementById('np-telefono').value = p.Telefono || '';
  document.getElementById('np-direccion').value = p.Direccion || '';
  document.getElementById('np-antecedentes').value = p.AntecedentesPatologicos || '';
  document.getElementById('np-alergias').value = p.Alergias || '';
  document.getElementById('np-obs').value = p.Observaciones || '';
  closeOverlay('modal-detail');
  abrirModalPaciente(true);
}

function guardarNuevoPaciente() {
  var nombre = document.getElementById('np-nombre').value.trim();
  if (!nombre) { showToast('⚠ El nombre es requerido'); return; }

  var btn = document.getElementById('btnGuardarPac');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  var data = {
    NombreCompleto: nombre,
    Cedula: document.getElementById('np-cedula').value,
    FechaNacimiento: document.getElementById('np-fechanac').value,
    Edad: document.getElementById('np-edad').value,
    Sexo: document.getElementById('np-sexo').value,
    TipoSangre: document.getElementById('np-sangre').value,
    Telefono: document.getElementById('np-telefono').value,
    Direccion: document.getElementById('np-direccion').value,
    AntecedentesPatologicos: document.getElementById('np-antecedentes').value,
    Alergias: document.getElementById('np-alergias').value,
    Observaciones: document.getElementById('np-obs').value
  };

  var editando = editandoPacienteId;
  if (editando) data.ID = editando;

  apiCall(editando ? 'editarPaciente' : 'agregarPaciente', data).then(function (json) {
      if (json.success) {
        showToast(editando ? '✓ Paciente actualizado' : '✓ Paciente registrado');
        closeOverlay('modal-addpac');
        editandoPacienteId = null;
        loadAll();
      } else { showToast('✗ ' + (json.error || 'Error al guardar')); }
      btn.disabled = false;
      btn.textContent = 'Guardar Paciente';
    });
}

function abrirEditarAtencion(id) {
  var a = atenciones.find(function(x) { return x.ID === id; });
  if (!a) return;
  editandoAtencionId = id;
  document.getElementById('edt-fecha').value = a.Fecha ? String(a.Fecha).split('T')[0] : '';
  document.getElementById('edt-hora').value = a.Hora || '';
  document.getElementById('edt-tipo').value = a.TipoAtencion || '';
  document.getElementById('edt-precio').value = a.Precio || '';
  document.getElementById('edt-estado').value = a.Estado || 'Completada';
  document.getElementById('edt-motivo').value = a.MotivoConsulta || '';
  document.getElementById('edt-tratamiento').value = a.Tratamiento || '';
  document.getElementById('edt-obs').value = a.Observaciones || '';
  document.getElementById('modal-editatencion').classList.add('open');
}

function guardarEdicionAtencion() {
  if (!editandoAtencionId) return;
  var btn = document.getElementById('btnGuardarEdicionAtencion');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  var idActual = editandoAtencionId;
  apiCall('actualizarAtencion', {
    ID: idActual,
    Fecha: document.getElementById('edt-fecha').value,
    Hora: document.getElementById('edt-hora').value,
    TipoAtencion: document.getElementById('edt-tipo').value,
    Precio: String(Number(document.getElementById('edt-precio').value) || 0),
    Estado: document.getElementById('edt-estado').value,
    MotivoConsulta: document.getElementById('edt-motivo').value,
    Tratamiento: document.getElementById('edt-tratamiento').value,
    Observaciones: document.getElementById('edt-obs').value
  }).then(function (json) {
    if (json.success) {
      showToast('✓ Atención actualizada');
      closeOverlay('modal-editatencion');
      editandoAtencionId = null;
      loadAll().then(function () {
        if (pacienteDetailActualId) openPacienteDetail(pacienteDetailActualId);
        renderReportes();
      });
    } else { showToast('✗ ' + (json.error || 'Error al guardar')); }
    btn.disabled = false;
    btn.textContent = 'Guardar Cambios';
  });
}

function openPacienteDetail(id) {
  pacienteDetailActualId = id;
  var p = pacientes.find(function(x) { return x.ID === id; });
  if (!p) return;
  var atPac = atenciones.filter(function(a) { return a.PacienteID === id; }).sort(function(a,b) { return b.Fecha > a.Fecha ? 1 : -1; });
  var appPac = appRecords.filter(function(a) { return a.PacienteID === id; }).sort(function(a,b) { return b.Fecha > a.Fecha ? 1 : -1; });
  var ultimoTratamiento = atPac.find(function(a) { return a.Tratamiento && a.Tratamiento.trim() !== ''; });
  document.getElementById('detail-title').textContent = p.NombreCompleto || 'Paciente';
  document.getElementById('detail-body').innerHTML =
    '<div style="padding:0 20px 14px">' +
    '<button onclick="abrirEditarPacienteActual()" style="width:100%;padding:10px;background:none;border:1px solid var(--border);border-radius:8px;color:var(--navy);font-family:\'Segoe UI\',Arial,sans-serif;font-size:13px;font-weight:600;cursor:pointer">✎ Editar datos del paciente</button>' +
    '</div>' +
    '<div style="padding:0 20px">' +
    '<div class="detail-section"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
    '<div><div class="detail-label">Cédula</div><div class="detail-value">' + esc(p.Cedula||'—') + '</div></div>' +
    '<div><div class="detail-label">Teléfono</div><div class="detail-value">' + esc(p.Telefono||'—') + '</div>' +
(p.Telefono ? '<div style="display:flex;gap:8px;margin-top:8px">' +
'<a href="tel:' + esc(p.Telefono) + '" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;background:#e6f4f2;color:#1a7a6e;border-radius:10px;text-decoration:none;font-size:13px;font-weight:500">📞 Llamar</a>' +
'<a href="https://wa.me/' + esc(String(p.Telefono).replace(/[^0-9]/g,'')) + '" target="_blank" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;background:#e7f8ee;color:#128C7E;border-radius:10px;text-decoration:none;font-size:13px;font-weight:500">💬 WhatsApp</a>' +
'</div>' : '') +
'</div>' +
    '<div><div class="detail-label">Edad</div><div class="detail-value">' + esc(calcEdad(p.FechaNacimiento)||p.Edad||'—') + ' años</div></div>' +
    '<div><div class="detail-label">Tipo Sangre</div><div class="detail-value">' + esc(p.TipoSangre||'—') + '</div></div>' +
    '<div><div class="detail-label">Sexo</div><div class="detail-value">' + esc(p.Sexo||'—') + '</div></div>' +
    '<div class="detail-section" style="background:#f0f9ff;border-radius:10px;padding:12px;margin-bottom:8px">' +
    '<div class="detail-label" style="color:#0f2a4a;font-weight:700">⚡ VISTA RÁPIDA</div>' +
    '<div style="margin-top:8px"><div class="detail-label">Último Tratamiento</div>' +
    '<div class="detail-value" style="margin-top:4px;color:#1a7a6e;font-weight:500">' + esc(ultimoTratamiento ? ultimoTratamiento.Tratamiento : 'Sin tratamiento registrado') + '</div></div>' +
    '<div style="margin-top:8px"><div class="detail-label">APP (Antecedentes Personales Patológicos)</div>' +
    (appPac.length ? appPac.map(function(a) { return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e0f0ff"><div style="font-size:13px;color:#1a2635">' + esc(a.Diagnostico) + (a.Notas ? ' — <span style="color:#6b7f96">' + esc(a.Notas) + '</span>' : '') + '</div><div style="font-size:11px;color:#6b7f96;white-space:nowrap;margin-left:8px">' + esc(formatDate(a.Fecha)) + '</div></div>'; }).join('') : '<div style="font-size:13px;color:#6b7f96;margin-top:4px">Sin registros</div>') +
    '<button onclick="abrirAgregarAPP(\'' + id + '\')" style="margin-top:10px;width:100%;padding:10px;background:#0f2a4a;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px">+ Agregar APP</button>' +
    '</div></div>' +
    '<div class="detail-section"><div class="detail-label">Antecedentes Patológicos</div><div class="detail-value" style="margin-top:4px">' + esc(p.AntecedentesPatologicos||'Ninguno') + '</div></div>' +
    '</div></div>' +
    '<div class="detail-section"><div class="detail-label">Alergias</div><div class="detail-value" style="margin-top:4px">' + esc(p.Alergias||'Ninguna') + '</div></div>' +
    (p.Observaciones ? '<div class="detail-section"><div class="detail-label">Observaciones</div><div class="detail-value" style="margin-top:4px">' + esc(p.Observaciones) + '</div></div>' : '') +
    '<div class="detail-section"><div class="detail-label" style="margin-bottom:8px">Atenciones (' + atPac.length + ')</div>' +
    (atPac.length === 0 ? '<div style="color:var(--muted);font-size:13px">Sin atenciones registradas</div>' :
      atPac.map(function(a) {
        return '<div onclick="abrirEditarAtencion(\'' + a.ID + '\')" style="padding:8px 0;border-bottom:1px solid var(--silver);cursor:pointer">' +
          '<div style="display:flex;justify-content:space-between">' +
          '<div style="font-size:13px;font-weight:500;color:var(--navy)">' + esc(formatDate(a.Fecha)) + '</div>' +
          '<span class="status ' + statusClass(a.Estado) + '">' + esc(a.Estado||'—') + '</span></div>' +
          '<div style="font-size:12px;color:var(--muted);margin-top:3px">' + esc(a.TipoAtencion||'') + (a.MotivoConsulta ? ' · ' + esc(a.MotivoConsulta) : '') + '</div>' +
          (a.Observaciones ? '<div style="font-size:12px;color:var(--muted);margin-top:2px">' + esc(a.Observaciones) + '</div>' : '') +
          '</div>';
      }).join('')) +
    '</div></div>';
  document.getElementById('modal-detail').classList.add('open');
}

// ═══════════════════════════════════════
// REPORTES
// ═══════════════════════════════════════
function setReportTab(tab, el) {
  currentReportTab = tab;
  document.querySelectorAll('.report-tab').forEach(function(b) { b.classList.remove('active'); });
  el.classList.add('active');
  renderReportes();
}

function renderReportes() {
  var body = document.getElementById('report-body');
  if (currentReportTab === 'semanal')  body.innerHTML = buildSemanal();
  if (currentReportTab === 'mensual')  body.innerHTML = buildMensual();
  if (currentReportTab === 'paciente') body.innerHTML = buildPacienteReport();
  if (currentReportTab === 'ingresos') body.innerHTML = buildIngresos();
}

function buildSemanal() {
  var rng      = getWeekRange(reportWeekOffset);
  var filtered = atenciones.filter(function(a) { var f = new Date(a.Fecha); return f >= rng.start && f <= rng.end; });
  var total    = filtered.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
  var comp     = filtered.filter(function(a) { return a.Estado === 'Completada'; }).length;
  var rows     = filtered.sort(function(a,b) { return a.Fecha > b.Fecha ? 1 : -1; }).map(function(a) {
    var pac = pacientes.find(function(p) { return p.ID === a.PacienteID; }) || {};
    return '<div class="report-row" onclick="abrirEditarAtencion(\'' + a.ID + '\')" style="cursor:pointer"><div><div class="report-row-name">' + esc(pac.NombreCompleto||'—') + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">' + esc(formatDate(a.Fecha)) + ' · ' + esc(a.TipoAtencion||'—') + '</div></div>' +
      '<div style="text-align:right"><div class="report-row-val">$' + Number(a.Precio||0).toFixed(2) + '</div>' +
      '<span class="status ' + statusClass(a.Estado) + '" style="margin-top:3px;display:inline-block">' + esc(a.Estado||'—') + '</span></div></div>';
  }).join('') || '<div style="padding:16px;color:var(--muted);font-size:13px">Sin atenciones esta semana</div>';

  return '<div class="report-nav">' +
    '<button onclick="reportWeekOffset--;renderReportes()"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>' +
    '<div class="report-nav-label">' + esc(weekLabel(rng.start, rng.end)) + '</div>' +
    '<button onclick="if(reportWeekOffset<0){reportWeekOffset++;renderReportes()}"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 20px 14px">' +
    '<div class="report-summary"><div class="report-summary-title">Total</div><div class="report-summary-val">$' + total.toFixed(2) + '</div><div class="report-summary-sub">' + filtered.length + ' atenciones</div></div>' +
    '<div class="report-summary"><div class="report-summary-title">Completadas</div><div class="report-summary-val">' + comp + '</div><div class="report-summary-sub">de ' + filtered.length + '</div></div></div>' +
    '<div class="report-card">' + rows + '</div>';
}

function buildMensual() {
  var mo      = getMonthOffset(reportMonthOffset);
  var meses   = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var filtered = atenciones.filter(function(a) { var f = new Date(a.Fecha); return f.getFullYear()===mo.year && f.getMonth()===mo.month; });
  var total    = filtered.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
  var byWeek   = {};
  filtered.forEach(function(a) { var w = getWeekOfMonth(new Date(a.Fecha)); if (!byWeek[w]) byWeek[w] = []; byWeek[w].push(a); });
  var weekRows = Object.keys(byWeek).sort().map(function(w) {
    var sub = byWeek[w]; var wTotal = sub.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
    return '<div class="report-row"><div class="report-row-name">Semana ' + esc(w) + '</div>' +
      '<div style="text-align:right"><div class="report-row-val">$' + wTotal.toFixed(2) + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">' + sub.length + ' atenciones</div></div></div>';
  }).join('') || '<div style="padding:16px;color:var(--muted);font-size:13px">Sin atenciones este mes</div>';

  return '<div class="report-nav">' +
    '<button onclick="reportMonthOffset--;renderReportes()"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>' +
    '<div class="report-nav-label">' + esc(meses[mo.month]) + ' ' + mo.year + '</div>' +
    '<button onclick="if(reportMonthOffset<0){reportMonthOffset++;renderReportes()}"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 20px 14px">' +
    '<div class="report-summary"><div class="report-summary-title">Total mes</div><div class="report-summary-val">$' + total.toFixed(2) + '</div><div class="report-summary-sub">' + filtered.length + ' atenciones</div></div>' +
    '<div class="report-summary"><div class="report-summary-title">Promedio/aten.</div><div class="report-summary-val">$' + (filtered.length ? (total/filtered.length).toFixed(2) : '0.00') + '</div><div class="report-summary-sub">por atención</div></div></div>' +
    '<div class="report-card">' + weekRows + '</div>';
}

function buildPacienteReport() {
  var opts = pacientes.sort(function(a,b) { return (a.NombreCompleto||'').localeCompare(b.NombreCompleto||''); })
    .map(function(p) { return '<option value="' + esc(p.ID) + '"' + (p.ID===reportPacienteID?' selected':'') + '>' + esc(p.NombreCompleto) + '</option>'; }).join('');
  var detail = '';
  if (reportPacienteID) {
    var pac    = pacientes.find(function(p) { return p.ID === reportPacienteID; }) || {};
    var atPac  = atenciones.filter(function(a) { return a.PacienteID === reportPacienteID; }).sort(function(a,b) { return b.Fecha > a.Fecha ? 1 : -1; });
    var totPac = atPac.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
    var rows   = atPac.map(function(a) {
      return '<div class="report-row" onclick="abrirEditarAtencion(\'' + a.ID + '\')" style="cursor:pointer"><div>' +
        '<div class="report-row-name">' + esc(formatDate(a.Fecha)) + ' ' + esc(formatHora(a.Hora)) + '</div>' +
        '<div style="font-size:11px;color:var(--muted)">' + esc(a.TipoAtencion||'—') + (a.MotivoConsulta ? ' · ' + esc(a.MotivoConsulta) : '') + '</div>' +
        (a.Observaciones ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc(a.Observaciones) + '</div>' : '') +
        '</div><div style="text-align:right"><div class="report-row-val">$' + Number(a.Precio||0).toFixed(2) + '</div>' +
        '<span class="status ' + statusClass(a.Estado) + '" style="margin-top:3px;display:inline-block">' + esc(a.Estado||'—') + '</span></div></div>';
    }).join('') || '<div style="padding:16px;color:var(--muted);font-size:13px">Sin atenciones</div>';
    detail = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 20px 14px">' +
      '<div class="report-summary"><div class="report-summary-title">Total pagado</div><div class="report-summary-val">$' + totPac.toFixed(2) + '</div><div class="report-summary-sub">' + atPac.length + ' atenciones</div></div>' +
      '<div class="report-summary"><div class="report-summary-title">Última visita</div><div class="report-summary-val" style="font-size:16px">' + (atPac.length ? esc(formatDate(atPac[0].Fecha)) : '—') + '</div></div></div>' +
      '<div class="report-card">' + rows + '</div>';
  }
  return '<div style="margin:16px 20px 14px">' +
    '<select style="width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:8px;font-family:\'Segoe UI\',Arial,sans-serif;font-size:14px;color:var(--text);outline:none" onchange="reportPacienteID=this.value;renderReportes()">' +
    '<option value="">— Seleccionar paciente —</option>' + opts + '</select></div>' + detail;
}

function buildIngresos() {
  var mo    = getMonthOffset(reportIngresosOffset);
  var meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var all   = atenciones.filter(function(a) {
    if (reportIngresosMode === 'mensual') { var f = new Date(a.Fecha); return f.getFullYear()===mo.year && f.getMonth()===mo.month; }
    return true;
  }).filter(function(a) { return a.Estado === 'Completada'; });
  var total  = all.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
  var byPac  = {};
  all.forEach(function(a) { if (!byPac[a.PacienteID]) byPac[a.PacienteID] = 0; byPac[a.PacienteID] += Number(a.Precio||0); });
  var pacRows = Object.entries(byPac).sort(function(a,b) { return b[1]-a[1]; }).map(function(entry) {
    var pac = pacientes.find(function(p) { return p.ID === entry[0]; }) || {};
    return '<div class="report-row"><div class="report-row-name">' + esc(pac.NombreCompleto||'Paciente') + '</div><div class="report-row-val">$' + entry[1].toFixed(2) + '</div></div>';
  }).join('') || '<div style="padding:16px;color:var(--muted);font-size:13px">Sin ingresos registrados</div>';

  var navHtml = reportIngresosMode === 'mensual' ?
    '<div class="report-nav">' +
    '<button onclick="reportIngresosOffset--;renderReportes()"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>' +
    '<div class="report-nav-label">' + esc(meses[mo.month]) + ' ' + mo.year + '</div>' +
    '<button onclick="if(reportIngresosOffset<0){reportIngresosOffset++;renderReportes()}"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button></div>' : '';

  return '<div style="display:flex;gap:8px;margin:16px 20px 4px">' +
    '<button class="report-tab ' + (reportIngresosMode==='mensual'?'active':'') + '" onclick="reportIngresosMode=\'mensual\';renderReportes()">Por mes</button>' +
    '<button class="report-tab ' + (reportIngresosMode==='total'?'active':'') + '" onclick="reportIngresosMode=\'total\';renderReportes()">Total</button></div>' +
    navHtml +
    '<div style="margin:10px 20px 14px"><div class="report-summary">' +
    '<div class="report-summary-title">Ingresos ' + (reportIngresosMode==='mensual'?'del mes':'totales') + ' (completadas)</div>' +
    '<div class="report-summary-val">$' + total.toFixed(2) + '</div>' +
    '<div class="report-summary-sub">' + all.length + ' atenciones completadas</div></div></div>' +
    '<div style="margin:0 20px 6px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px">Por paciente</div>' +
    '<div class="report-card">' + pacRows + '</div>';
}

// ═══════════════════════════════════════
// EXPORTAR PDF
// ═══════════════════════════════════════
function exportarPDF() {
  var btn = document.getElementById('btnPDF');
  btn.disabled = true;
  btn.textContent = 'Generando...';

  try {
    var doc    = new window.jspdf.jsPDF();
    var titulo = 'Reporte MedControl';
    var fecha  = new Date().toLocaleDateString('es-PA');
    var lineas = [];
    var meses  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    if (currentReportTab === 'semanal') {
      var rng      = getWeekRange(reportWeekOffset);
      titulo       = 'Reporte Semanal - ' + weekLabel(rng.start, rng.end);
      var filtered = atenciones.filter(function(a) { var f = new Date(a.Fecha); return f >= rng.start && f <= rng.end; });
      var total    = filtered.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
      lineas.push('Total: $' + total.toFixed(2) + ' | Atenciones: ' + filtered.length);
      lineas.push('');
      filtered.sort(function(a,b) { return a.Fecha > b.Fecha ? 1 : -1; }).forEach(function(a) {
        var pac = pacientes.find(function(p) { return p.ID === a.PacienteID; }) || {};
        lineas.push(formatDate(a.Fecha) + ' ' + formatHora(a.Hora) + ' - ' + (pac.NombreCompleto||'—'));
        lineas.push('Tipo: ' + (a.TipoAtencion||'—') + '  Estado: ' + (a.Estado||'—') + '  Precio: $' + Number(a.Precio||0).toFixed(2));
        if (a.MotivoConsulta) lineas.push('Motivo: ' + a.MotivoConsulta);
        if (a.Observaciones)  lineas.push('Obs: ' + a.Observaciones);
        lineas.push('---');
      });
    }

    else if (currentReportTab === 'mensual') {
      var mo       = getMonthOffset(reportMonthOffset);
      titulo       = 'Reporte Mensual - ' + meses[mo.month] + ' ' + mo.year;
      var filtered = atenciones.filter(function(a) { var f = new Date(a.Fecha); return f.getFullYear()===mo.year && f.getMonth()===mo.month; });
      var total    = filtered.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
      lineas.push('Total: $' + total.toFixed(2) + ' | Atenciones: ' + filtered.length);
      lineas.push('Promedio por atención: $' + (filtered.length ? (total/filtered.length).toFixed(2) : '0.00'));
      lineas.push('');
      filtered.sort(function(a,b) { return a.Fecha > b.Fecha ? 1 : -1; }).forEach(function(a) {
        var pac = pacientes.find(function(p) { return p.ID === a.PacienteID; }) || {};
        lineas.push(formatDate(a.Fecha) + ' - ' + (pac.NombreCompleto||'—') + ' - $' + Number(a.Precio||0).toFixed(2) + ' - ' + (a.Estado||'—'));
      });
    }

    else if (currentReportTab === 'paciente') {
      if (!reportPacienteID) { showToast('⚠ Selecciona un paciente'); btn.disabled=false; btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Exportar PDF'; return; }
      var pac   = pacientes.find(function(p) { return p.ID === reportPacienteID; }) || {};
      var atPac = atenciones.filter(function(a) { return a.PacienteID === reportPacienteID; }).sort(function(a,b) { return b.Fecha > a.Fecha ? 1 : -1; });
      titulo    = 'Historial - ' + (pac.NombreCompleto||'Paciente');
      lineas.push('Cédula: ' + (pac.Cedula||'—') + '  Teléfono: ' + (pac.Telefono||'—'));
      lineas.push('Edad: ' + (calcEdad(pac.FechaNacimiento)||pac.Edad||'—') + '  Sangre: ' + (pac.TipoSangre||'—'));
      lineas.push('Antecedentes: ' + (pac.AntecedentesPatologicos||'Ninguno'));
      lineas.push('Alergias: ' + (pac.Alergias||'Ninguna'));
      lineas.push('');
      lineas.push('ATENCIONES (' + atPac.length + ')');
      lineas.push('');
      atPac.forEach(function(a) {
        lineas.push(formatDate(a.Fecha) + ' ' + formatHora(a.Hora));
        lineas.push('Tipo: ' + (a.TipoAtencion||'—') + '  Estado: ' + (a.Estado||'—') + '  Precio: $' + Number(a.Precio||0).toFixed(2));
        if (a.MotivoConsulta) lineas.push('Motivo: ' + a.MotivoConsulta);
        if (a.Observaciones)  lineas.push('Obs: ' + a.Observaciones);
        lineas.push('---');
      });
    }

    else if (currentReportTab === 'ingresos') {
      var mo      = getMonthOffset(reportIngresosOffset);
      titulo      = reportIngresosMode === 'mensual' ? 'Ingresos - ' + meses[mo.month] + ' ' + mo.year : 'Ingresos Totales';
      var all     = atenciones.filter(function(a) {
        if (reportIngresosMode === 'mensual') { var f = new Date(a.Fecha); return f.getFullYear()===mo.year && f.getMonth()===mo.month; }
        return true;
      }).filter(function(a) { return a.Estado === 'Completada'; });
      var total   = all.reduce(function(s,a) { return s + Number(a.Precio||0); }, 0);
      lineas.push('Total ingresos: $' + total.toFixed(2));
      lineas.push('Atenciones completadas: ' + all.length);
      lineas.push('');
      all.sort(function(a,b) { return a.Fecha > b.Fecha ? 1 : -1; }).forEach(function(a) {
        var pac = pacientes.find(function(p) { return p.ID === a.PacienteID; }) || {};
        lineas.push(formatDate(a.Fecha) + ' - ' + (pac.NombreCompleto||'—') + ' - $' + Number(a.Precio||0).toFixed(2));
      });
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(titulo, 14, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Generado: ' + fecha, 14, 25);
    doc.setLineWidth(0.3);
    doc.line(14, 28, 196, 28);

    var y = 35;
    doc.setFontSize(10);
    lineas.forEach(function(linea) {
      var split = doc.splitTextToSize(linea, 180);
      split.forEach(function(txt) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(txt, 14, y);
        y += 6;
      });
    });

    doc.save(titulo.replace(/ /g,'_') + '.pdf');
    showToast('✓ PDF exportado');
  } catch(err) {
    console.error(err);
    showToast('✗ Error al exportar PDF');
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Exportar PDF';
}

// ═══════════════════════════════════════
// OVERLAYS
// ═══════════════════════════════════════
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.overlay').forEach(function(o) {
  o.addEventListener('click', function(e) { if (e.target === o) o.classList.remove('open'); });
});

// ═══════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════
function calcEdad(fechaNac) {
  if (!fechaNac) return '';
  var nac = new Date(fechaNac);
  if (isNaN(nac)) return '';
  var hoy = new Date();
  var edad = hoy.getFullYear() - nac.getFullYear();
  var m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad >= 0 ? String(edad) : '';
}

function calcEdadNuevo() {
  var val = document.getElementById('np-fechanac').value;
  document.getElementById('np-edad').value = calcEdad(val) ? calcEdad(val) + ' años' : '';
}

function formatDate(val) {
  if (!val) return '—';
  var d = new Date(val);
  if (isNaN(d)) return String(val).split('T')[0];
  return d.toLocaleDateString('es-PA', {day:'2-digit', month:'2-digit', year:'numeric'});
}

function formatHora(val) {
  if (!val) return '';
  return String(val).substring(0, 5);
}

function statusClass(s) {
  var m = {Completada:'status-completada', Cancelada:'status-cancelada', Pendiente:'status-pendiente', Pospuesta:'status-pospuesta'};
  return m[s] || '';
}

function getWeekRange(offset) {
  var now = new Date(); var day = now.getDay();
  var mon = new Date(now);
  mon.setDate(now.getDate() - (day===0?6:day-1) + offset*7);
  mon.setHours(0,0,0,0);
  var sun = new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999);
  return {start:mon, end:sun};
}

function weekLabel(start, end) {
  return start.getDate() + '/' + (start.getMonth()+1) + ' – ' + end.getDate() + '/' + (end.getMonth()+1) + '/' + end.getFullYear();
}

function getMonthOffset(offset) {
  var now = new Date(); var year = now.getFullYear(); var month = now.getMonth() + offset;
  while (month < 0)  { month += 12; year--; }
  while (month > 11) { month -= 12; year++; }
  return {year:year, month:month};
}

function getWeekOfMonth(d) { return Math.ceil(d.getDate()/7); }

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2800);
}

// ═══════════════════════════════════════
// APP (Antecedentes Personales Patológicos)
// ═══════════════════════════════════════
function abrirAgregarAPP(pacienteId) {
  var overlay = document.createElement('div');
  overlay.id = 'overlay-app';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,42,74,0.5);z-index:400;display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML =
    '<div style="background:white;width:100%;max-width:430px;border-radius:20px 20px 0 0;padding:20px 0 40px">' +
    '<div style="width:36px;height:4px;background:#d8e2ec;border-radius:2px;margin:0 auto 18px"></div>' +
    '<div style="font-family:Georgia,serif;font-size:20px;color:#0f2a4a;margin:0 20px 18px">Nuevo APP</div>' +
    '<div style="margin:0 20px 14px"><label style="display:block;font-size:11px;font-weight:600;color:#4a6080;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:5px">Fecha</label>' +
    '<input type="date" id="app-fecha" style="width:100%;padding:11px 14px;border:1px solid #d8e2ec;border-radius:8px;font-size:14px" /></div>' +
    '<div style="margin:0 20px 14px"><label style="display:block;font-size:11px;font-weight:600;color:#4a6080;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:5px">Diagnóstico</label>' +
    '<input type="text" id="app-diagnostico" placeholder="Ej. Hipertensión arterial" style="width:100%;padding:11px 14px;border:1px solid #d8e2ec;border-radius:8px;font-size:14px" /></div>' +
    '<div style="margin:0 20px 14px"><label style="display:block;font-size:11px;font-weight:600;color:#4a6080;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:5px">Notas</label>' +
    '<textarea id="app-notas" placeholder="Detalles adicionales..." style="width:100%;padding:11px 14px;border:1px solid #d8e2ec;border-radius:8px;font-size:14px;resize:vertical;min-height:80px"></textarea></div>' +
    '<button onclick="guardarAPP(\'' + pacienteId + '\')" style="width:calc(100% - 40px);margin:0 20px;background:#0f2a4a;color:white;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:600;cursor:pointer">Guardar APP</button>' +
    '<button onclick="document.getElementById(\'overlay-app\').remove()" style="width:100%;padding:12px;background:none;border:none;color:#6b7f96;font-size:14px;cursor:pointer;margin-top:6px">Cancelar</button>' +
    '</div>';
  document.body.appendChild(overlay);
  document.getElementById('app-fecha').value = new Date().toISOString().split('T')[0];
}

function guardarAPP(pacienteId) {
  var fecha       = document.getElementById('app-fecha').value;
  var diagnostico = document.getElementById('app-diagnostico').value.trim();
  var notas       = document.getElementById('app-notas').value;
  if (!diagnostico) { alert('El diagnóstico es requerido'); return; }
  var btn = document.querySelector('#overlay-app button');
  btn.disabled = true; btn.textContent = 'Guardando...';
  apiCall('agregarAPP', { PacienteID: pacienteId, Fecha: fecha, Diagnostico: diagnostico, Notas: notas })
    .then(function (json) {
      if (json.success) {
        appRecords.push({ ID: json.id, PacienteID: pacienteId, Fecha: fecha, Diagnostico: diagnostico, Notas: notas });
        document.getElementById('overlay-app').remove();
        openPacienteDetail(pacienteId);
      } else { alert(json.error || 'Error al guardar'); btn.disabled = false; btn.textContent = 'Guardar APP'; }
    })
    .catch(function () { alert('Error de conexión'); btn.disabled = false; btn.textContent = 'Guardar APP'; });
}

// PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function(e){ console.log('SW error:', e); });
  });
}
