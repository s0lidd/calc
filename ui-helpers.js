// ----- Переходи між сторінками
(function () {
	// 1. Миттєво приховуємо сторінку при старті парсингу, щоб уникнути білого спалаху (FOUC)
	const style = document.createElement('style');
	style.id = 'seamless-local-loader';
	document.head.appendChild(style);

	// Універсальна перевірка всіх картинок на сторінці
	function checkCompletedImages() {
		document.querySelectorAll('img.tile-img').forEach(img => {
			// Показуємо картинку якщо вона:
			// 1. Вже завантажена з кешу
			// 2. Взагалі не має атрибута src (це просто заглушка з alt-емодзі)
			if (img.complete || !img.getAttribute('src')) {
				img.classList.add('loaded');
			}
		});
	}

	// Затримка на 2 кадри гарантує, що DOM повністю відсортується ДО проявлення екрану (усуває мигання)
	window.addEventListener('load', () => {
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				document.documentElement.classList.add('page-ready');
				checkCompletedImages();
			});
		});
	});

	// 3. Захист від bfcache (якщо користувач повернувся назад кнопкою браузера)
	window.addEventListener('pageshow', (event) => {
		if (event.persisted) {
			requestAnimationFrame(() => {
				document.documentElement.classList.add('page-ready');
				checkCompletedImages();
			});
		}
	});

	// 4. Глобальний перехоплювач події завантаження картинок (для динамічних зображень)
	document.addEventListener('load', (e) => {
		if (e.target && e.target.tagName === 'IMG' && e.target.classList.contains('tile-img')) {
			e.target.classList.add('loaded');
		}
	}, true); // true (capture phase) дозволяє зловити load до того, як він спливе

	// Перехоплюємо помилки (наприклад, якщо src битий — все одно показуємо alt)
	document.addEventListener('error', (e) => {
		if (e.target && e.target.tagName === 'IMG' && e.target.classList.contains('tile-img')) {
			e.target.classList.add('loaded');
		}
	}, true);

	document.addEventListener('DOMContentLoaded', checkCompletedImages);
})();

// ----- МЕНЕДЖЕР ЗАКРІПЛЕННЯ ТА ПОРЯДКУ ПЛИТОК (PIN MANAGER) -----
const PIN_PREFIX = 'ut_pins_';

function getPagePins() {
	const pagePath = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
	try {
		return JSON.parse(localStorage.getItem(PIN_PREFIX + pagePath)) || [];
	} catch { return []; }
}

function savePagePins(pins) {
	const pagePath = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
	localStorage.setItem(PIN_PREFIX + pagePath, JSON.stringify(pins));
}

// Функція автоматичного налаштування кожної плитки на сторінці
function setupTile(tile) {
	if (tile.hasAttribute('data-pin-setup')) return;
	tile.setAttribute('data-pin-setup', 'true');

	// Якщо у плитки немає ID (наприклад, статичні сторінки-посилання), генеруємо його з посилання
	if (!tile.id) {
		const identifier = tile.getAttribute('href') || tile.textContent;
		tile.id = 't_' + identifier.replace(/[^a-zA-Z0-9]/g, '_');
	}

	// Додаємо ім'я транзиції, якщо workers.js його не додав (потрібно для анімації на головній)
	if (!tile.style.viewTransitionName) {
		tile.style.viewTransitionName = 'vt-card-' + tile.id;
	}

	// SVG Іконки
	const iconStar = `
		<div class="icon-wrapper">
			<div class="icon-mask icon-star-inactive"></div>
			<div class="icon-mask icon-star-active"></div>
		</div>`;
	const iconLeft = `
		<div class="icon-wrapper">
			<div class="icon-mask icon-left-arrow"></div>
		</div>`;
	const iconRight = `
		<div class="icon-wrapper">
			<div class="icon-mask icon-right-arrow"></div>
		</div>`;

	// Вбудовуємо кнопки
	tile.insertAdjacentHTML('beforeend', `
		<button class="tile-action-btn tile-pin-btn">${iconStar}</button>
		<button class="tile-action-btn tile-reorder-btn left">${iconLeft}</button>
		<button class="tile-action-btn tile-reorder-btn right">${iconRight}</button>
	`);
}

// Застосування стилів з використанням нативної Web Animations API (WAAPI)
function applyPinStyles(shouldAnimate = false) {
	const pins = getPagePins();

	// Знаходимо всі унікальні контейнери з плитками на сторінці
	const containers = new Set();
	document.querySelectorAll('.tile').forEach(t => {
		if (t.parentNode) containers.add(t.parentNode);
	});

	// Якщо плиток немає взагалі — виходимо
	if (containers.size === 0) return;

	const updateDOM = () => {
		if (domObserver) domObserver.disconnect();

		// Обробляємо КОЖЕН контейнер абсолютно ізольовано
		containers.forEach(container => {
			const currentTilesInDOM = Array.from(container.querySelectorAll('.tile'));

			// 1. Знаходимо закріплені плитки ТІЛЬКИ для цього конкретного блоку
			// і сортуємо їх так, як вони лежать у збереженому масиві pins
			const localPinnedTiles = currentTilesInDOM
				.filter(t => t.id && pins.includes(t.id))
				.sort((a, b) => pins.indexOf(a.id) - pins.indexOf(b.id));

			// 2. Оновлюємо класи, індекси та показуємо/ховаємо стрілки ЛОКАЛЬНО
			currentTilesInDOM.forEach(tile => {
				tile.style.order = ''; // Очищаємо залишки старого CSS

				if (!tile.id) return;

				// Беремо локальний індекс (від 0 до кількості закріплених у ЦЬОМУ блоці)
				const localIndex = localPinnedTiles.indexOf(tile);
				const btnLeft = tile.querySelector('.tile-reorder-btn.left');
				const btnRight = tile.querySelector('.tile-reorder-btn.right');

				if (localIndex > -1) {
					tile.classList.add('pinned');
					tile.setAttribute('data-pin-index', localIndex);

					// Якщо в цьому блоці закріплена лише 1 плитка — жодних стрілок!
					if (btnLeft) btnLeft.style.display = localIndex === 0 ? 'none' : 'flex';
					if (btnRight) btnRight.style.display = localIndex === localPinnedTiles.length - 1 ? 'none' : 'flex';
				} else {
					tile.classList.remove('pinned');
					tile.removeAttribute('data-pin-index');
					if (btnLeft) btnLeft.style.display = '';
					if (btnRight) btnRight.style.display = '';
				}
			});

			// 3. Сортуємо вузли всередині поточного контейнера
			const sortedTiles = currentTilesInDOM.sort((a, b) => {
				const isPinnedA = a.classList.contains('pinned');
				const isPinnedB = b.classList.contains('pinned');

				// Якщо обидва закріплені - сортуємо за порядком користувача
				if (isPinnedA && isPinnedB) {
					return parseInt(a.getAttribute('data-pin-index')) - parseInt(b.getAttribute('data-pin-index'));
				}
				// Закріплені завжди вище
				if (isPinnedA) return -1;
				if (isPinnedB) return 1;

				// Якщо відкріплені - повертаємо їх на оригінальні позиції (Base Order)
				const orderA = parseInt(a.getAttribute('data-base-order')) || 0;
				const orderB = parseInt(b.getAttribute('data-base-order')) || 0;
				return orderA - orderB;
			});

			// 4. Фізично переміщуємо вузли у їхньому рідному контейнері
			sortedTiles.forEach(tile => container.appendChild(tile));
		});

		// Вмикаємо спостерігач назад
		if (domObserver) domObserver.observe(document.body, { childList: true, subtree: true });
	};

	// Якщо браузер підтримує View Transitions і нам потрібна анімація — запускаємо нативну красу!
	if (shouldAnimate && document.startViewTransition) {
		document.startViewTransition(() => updateDOM());
	} else {
		updateDOM();
	}
}

// Запускаємо спостерігач, який автоматично зловить усі плитки 
// навіть якщо вони створюються JS-фільтром на сторінці працівників
const domObserver = new MutationObserver((mutations) => {
	let hasNewTiles = false;
	mutations.forEach(m => {
		m.addedNodes.forEach(node => {
			if (node.nodeType === 1) {
				if (node.classList && node.classList.contains('tile')) {
					setupTile(node);
					hasNewTiles = true;
				} else if (node.querySelectorAll) {
					const tiles = node.querySelectorAll('.tile');
					if (tiles.length) {
						tiles.forEach(setupTile);
						hasNewTiles = true;
					}
				}
			}
		});
	});

	if (hasNewTiles) {
		// ЯКЩО workers.js ЗМІНИВ СОРТУВАННЯ — ФІКСУЄМО НОВИЙ ІДЕАЛЬНИЙ ПОРЯДОК
		const containers = new Set();
		document.querySelectorAll('.tile').forEach(t => {
			if (t.parentNode) containers.add(t.parentNode);
		});

		containers.forEach(container => {
			Array.from(container.children).forEach((child, idx) => {
				if (child.classList && child.classList.contains('tile')) {
					child.setAttribute('data-base-order', idx);
				}
			});
		});

		// І тільки після збереження порядку накладаємо піни зверху
		applyPinStyles(false);
	}
});

document.addEventListener('DOMContentLoaded', () => {
	domObserver.observe(document.body, { childList: true, subtree: true });

	// Фіксуємо базовий порядок для статичних сторінок (index.html, документи)
	const containers = new Set();
	document.querySelectorAll('.tile').forEach(tile => {
		setupTile(tile);
		if (tile.parentNode) containers.add(tile.parentNode);
	});

	containers.forEach(container => {
		Array.from(container.children).forEach((child, idx) => {
			if (child.classList && child.classList.contains('tile')) {
				child.setAttribute('data-base-order', idx);
			}
		});
	});
	applyPinStyles(false);
});

// ----- АВТОЗБЕРЕЖЕННЯ ІНПУТІВ ТА СТАНІВ -----
const SAVE_PREFIX = 'ut_save_';

// Функція збереження стану одного елемента
window.saveAutoSaveState = function (el) {
	if (!el) return;

	// Додаємо назву сторінки до ключа, щоб інпути з однаковими ID на різних сторінках не змішувались
	const pagePath = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
	const pageKey = pagePath + '_';

	if (el.type === 'radio') {
		// Радіо-кнопки зберігаємо за їхнім name (оскільки ID у них немає)
		if (el.name && el.checked) localStorage.setItem(SAVE_PREFIX + pageKey + el.name, el.value);
	} else if (el.id) {
		// Чекбокси зберігаємо як true/false
		if (el.type === 'checkbox') localStorage.setItem(SAVE_PREFIX + pageKey + el.id, el.checked);
		// Звичайні інпути та календарі
		else localStorage.setItem(SAVE_PREFIX + pageKey + el.id, el.value);
	}
};

// Функція відновлення всіх станів при завантаженні
function restoreAutoSaveState() {
	const pagePath = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
	const pageKey = pagePath + '_';

	document.querySelectorAll('input').forEach(el => {
		if (el.type === 'radio' && el.name) {
			const savedVal = localStorage.getItem(SAVE_PREFIX + pageKey + el.name);
			if (savedVal !== null) el.checked = (el.value === savedVal);
		} else if (el.id) {
			const savedVal = localStorage.getItem(SAVE_PREFIX + pageKey + el.id);
			if (savedVal !== null) {
				if (el.type === 'checkbox') el.checked = (savedVal === 'true');
				else {
					// Якщо це календар Flatpickr, оновлюємо саме його ядро
					if (el._flatpickr) {
						el._flatpickr.setDate(savedVal, false);
						if (savedVal) el.classList.remove('empty-warning');
					} else el.value = savedVal;
				}
			}
		}
	});

	// Після підстановки даних, автоматично запускаємо залежні функції (якщо вони є на сторінці)
	if (typeof handleDriverSelect === 'function') handleDriverSelect();
	if (typeof calculateQueue === 'function') calculateQueue();
}

// Глобальна функція очищення
window.clearInputDirectly = function (id, isMassClear = false) {
	const el = document.getElementById(id);
	if (el) {
		// Очищуємо значення
		if (el._flatpickr) el._flatpickr.clear();
		else el.value = '';

		if (el.awesomplete) el.awesomplete.close();

		// Якщо це поодиноке очищення (хрестиком), або це калькулятор черги — запускаємо оновлення
		if (!isMassClear) el.dispatchEvent(new Event('input', { bubbles: true }));

		// Миттєво кешуємо порожнє значення після очищення
		window.saveAutoSaveState(el);
	}
	// Знімаємо підсвітку дати
	if (id === 'rest_adoption_date_input' && el) el.classList.remove('empty-warning');
};

// Функція зміни числа стрілочками
function spinNumberValue(id, dir) {
	const el = document.getElementById(id);
	if (!el) return;
	let val = el.value;
	if (!val) el.value = dir > 0 ? "1" : "0";
	else {
		if (/\d/.test(val)) {
			el.value = val.replace(/(\d+)(?!.*\d)/, (m) => {
				let num = parseInt(m, 10) + dir;
				return num >= 0 ? num : 0;
			});
		} else el.value = val + (dir > 0 ? "1" : "0");
	}
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ----- КОНТРОЛЬ КЛІКІВ ТА ПЛАВНОГО ВИХОДУ -----
function initCORSReadyNavigation() {
	document.addEventListener('click', (e) => {
		const link = e.target.closest('a');

		// Ігноруємо порожні посилання, зовнішні вкладки, завантаження та якірні лінки (#)
		if (!link || link.target === '_blank' || link.hasAttribute('download') || link.getAttribute('href').startsWith('#')) return;

		const targetUrl = new URL(link.href, window.location.href);

		// Працюємо лише в межах одного протоколу (наприклад, локальних файлів)
		if (targetUrl.protocol !== window.location.protocol) return;

		e.preventDefault();

		// 1. Запускаємо плавне згасання поточної сторінки (220мс)
		document.documentElement.classList.remove('page-ready');

		// 2. Після закінчення анімації здійснюємо абсолютно чистий і нативний перехід
		setTimeout(() => window.location.href = link.href, 220);
	});
}

// Загальна реєстрація глобальних подій (без дублювання та конфліктів)
if (!window.globalEventsRegistered) {
	window.globalEventsRegistered = true;

	// Ініціалізуємо безпечну локальну навігацію
	initCORSReadyNavigation();

	// ПЕРЕХВАТ КЛІКІВ НА КНОПКАХ ПЛИТОК (НА ФАЗІ CAPTURE)
	document.addEventListener('click', (e) => {
		const actionBtn = e.target.closest('.tile-action-btn');
		if (!actionBtn) return;

		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();

		const tile = actionBtn.closest('.tile');
		if (!tile || !tile.id) return;

		let pins = getPagePins();
		const currentIdx = pins.indexOf(tile.id);

		if (actionBtn.classList.contains('tile-pin-btn')) {
			if (currentIdx > -1) {
				pins.splice(currentIdx, 1);
			} else {
				pins.push(tile.id);
			}
		} else if (actionBtn.classList.contains('left') && currentIdx > 0) {
			[pins[currentIdx - 1], pins[currentIdx]] = [pins[currentIdx], pins[currentIdx - 1]];
		} else if (actionBtn.classList.contains('right') && currentIdx > -1 && currentIdx < pins.length - 1) {
			[pins[currentIdx + 1], pins[currentIdx]] = [pins[currentIdx], pins[currentIdx + 1]];
		}

		savePagePins(pins);
		// Викликаємо функцію сортування З УВІМКНЕНОЮ анімацією
		applyPinStyles(true);
	}, true); // true вмикає фазу перехоплення (capture)

	// Слухачі автозбереження
	document.addEventListener('input', (e) => window.saveAutoSaveState(e.target));
	document.addEventListener('change', (e) => window.saveAutoSaveState(e.target));
	document.addEventListener('awesomplete-selectcomplete', (e) => window.saveAutoSaveState(e.target));

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			document.querySelectorAll('input').forEach(el => window.saveAutoSaveState(el));
		}
	});

	window.addEventListener('load', restoreAutoSaveState);

	document.addEventListener('DOMContentLoaded', () => {
		if (typeof OverlayScrollbarsGlobal !== 'undefined') {
			OverlayScrollbarsGlobal.OverlayScrollbars(document.body, {
				scrollbars: { theme: 'os-theme-dark', autoHide: 'leave', clickScroll: true }
			});
		}
	});

	// Кліки по стрілочках спінера
	document.addEventListener('click', (e) => {
		if (e.target.classList.contains('spinner-up') || e.target.classList.contains('spinner-down')) {
			const inputGroup = e.target.closest('.input-group');
			if (inputGroup) {
				const input = inputGroup.querySelector('input');
				if (input) spinNumberValue(input.id, e.target.classList.contains('spinner-up') ? 1 : -1);
			}
		}
	});

	// Підтримка клавіатури (Вверх/Вниз)
	document.addEventListener('keydown', function (e) {
		if (e.target && (e.target.id.includes('number') || e.target.id.includes('queue') || e.target.id.includes('shift'))) {
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				spinNumberValue(e.target.id, 1);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				spinNumberValue(e.target.id, -1);
			}
		}
	});

	// Кліки по одиночних хрестиках «✕» на інпутах
	document.addEventListener('click', (e) => {
		if (e.target.classList.contains('clear-btn')) {
			const inputGroup = e.target.closest('.input-group');
			if (inputGroup) {
				const input = inputGroup.querySelector('input');
				if (input) {
					// При одиночному кліку на хрестик — очищуємо з подією input і повертаємо фокус
					window.clearInputDirectly(input.id, false);
					input.focus();
				}
			}
		}
	});

	// Слухач скролу шапки
	const handleHeaderScroll = () => {
		const topBlur = document.querySelector('.top-blur');
		if (topBlur) {
			if (window.scrollY > 5) topBlur.classList.add('scrolled');
			else topBlur.classList.remove('scrolled');
		}
	};
	window.addEventListener('scroll', handleHeaderScroll, { passive: true });
}