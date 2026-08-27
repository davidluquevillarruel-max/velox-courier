/* ============================================================
   combobox.js — Campo de texto con lista buscable
   Reemplazo de <select> largos (tiendas, distritos, motorizados):
   el usuario escribe, la lista se filtra, y tiene que elegir un
   ítem de la lista para que quede seleccionado (no admite texto
   libre que no esté en el catálogo).
   ============================================================ */

/**
 * Convierte un <input> en un combobox buscable.
 * @param {string} inputId - ID del <input> de texto ya existente en el HTML.
 * @param {function(): Array<{value:string, label:string}>} obtenerOpciones
 *        Función que devuelve el catálogo actual (se llama en cada apertura,
 *        así siempre refleja el catálogo cargado más reciente).
 * @param {function(string)} [onSeleccionar] - Se llama con el value elegido.
 * @returns {{ setValor: function(string), limpiar: function() }}
 */
function initComboBuscable(inputId, obtenerOpciones, onSeleccionar) {
  var input = document.getElementById(inputId);
  if (!input) return null;

  input.setAttribute('autocomplete', 'off');

  /* La lista necesita un ancestro con position != static para ubicarse
     justo debajo del input */
  var padre = input.parentNode;
  if (padre && getComputedStyle(padre).position === 'static') {
    padre.style.position = 'relative';
  }

  var lista = document.createElement('div');
  lista.className = 'combo-list';
  input.insertAdjacentElement('afterend', lista);

  var valorValido = input.value || '';

  function render(filtro) {
    var texto = (filtro || '').toLowerCase().trim();
    var opciones = obtenerOpciones().filter(function(op) {
      return op.label.toLowerCase().indexOf(texto) !== -1;
    });

    lista.innerHTML = opciones.length
      ? opciones.map(function(op) {
          return '<div class="combo-item" data-valor="' + op.value.replace(/"/g, '&quot;') + '">' +
            op.label + '</div>';
        }).join('')
      : '<div class="combo-empty">Sin resultados</div>';

    lista.style.display = 'block';
  }

  input.addEventListener('focus', function() { render(input.value); });
  input.addEventListener('input', function() {
    valorValido = '';
    render(input.value);
  });

  /* mousedown (no click) para que dispare ANTES del blur del input */
  lista.addEventListener('mousedown', function(e) {
    var item = e.target.closest('.combo-item');
    if (!item) return;
    e.preventDefault();

    var valor = item.getAttribute('data-valor');
    input.value = valor;
    valorValido = valor;
    lista.style.display = 'none';
    if (typeof onSeleccionar === 'function') onSeleccionar(valor);
  });

  input.addEventListener('blur', function() {
    setTimeout(function() {
      lista.style.display = 'none';
      /* Si lo que quedó escrito no corresponde a algo elegido de la
         lista, se limpia: no se admite texto libre como selección */
      if (input.value !== valorValido) {
        input.value = '';
        if (typeof onSeleccionar === 'function') onSeleccionar('');
      }
    }, 150);
  });

  return {
    setValor: function(valor) {
      input.value = valor || '';
      valorValido = valor || '';
    },
    limpiar: function() {
      input.value = '';
      valorValido = '';
    },
  };
}
