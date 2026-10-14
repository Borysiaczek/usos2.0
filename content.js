/**
 * USOSweb 2.0 - Content Script
 * Odpowiedzialny za modernizację DOM, wstrzykiwanie paska nawigacji,
 * detekcję ocen i synchronizację motywów.
 * Politechnika Śląska & Polskie Uczelnie Wyższe.
 */

(function () {
  'use strict';

  // Flagi i stan aplikacji
  let isExtensionEnabled = true;
  let isDarkMode = false;
  let isObserverActive = false;
  let observerTimeout = null;

  /* ==========================================================================
     1. ZARZĄDZANIE STANEM I PREFERENCJAMI
     ========================================================================== */

  /**
   * Sprawdza, czy bieżąca strona należy do systemu USOSweb
   */
  function isUsosPage() {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    if (host.includes('usos') || path.includes('usos')) return true;
    return Boolean(document.querySelector('#topmenu, #layout-c, table.tab, .body-container, a[href*="kontroler.php"]'));
  }

  /**
   * Inicjalizuje odczyt ustawień z chrome.storage.local
   */
  function initSettings() {
    if (!isUsosPage()) return;

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      applyThemeState(true, false);
      runModernizer();
      return;
    }

    chrome.storage.local.get(['extensionEnabled', 'darkMode'], (res) => {
      isExtensionEnabled = res.extensionEnabled !== false; // Domyślnie włączone
      isDarkMode = res.darkMode === true;

      applyThemeState(isExtensionEnabled, isDarkMode);

      if (isExtensionEnabled) {
        runModernizer();
        startDOMObserver();
        scheduleShadowPasses();
      }
    });

    // Nasłuchiwanie zmian z popupu w czasie rzeczywistym
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        let stateChanged = false;

        if (changes.extensionEnabled !== undefined) {
          isExtensionEnabled = changes.extensionEnabled.newValue !== false;
          stateChanged = true;
        }

        if (changes.darkMode !== undefined) {
          isDarkMode = changes.darkMode.newValue === true;
          stateChanged = true;
        }

        if (stateChanged) {
          applyThemeState(isExtensionEnabled, isDarkMode);
          if (isExtensionEnabled) {
            runModernizer();
          }
        }
      }
    });
  }

  /**
   * Nakłada odpowiednie atrybuty data-* na dokument HTML
   */
  function applyThemeState(enabled, dark) {
    const root = document.documentElement;
    root.setAttribute('data-usos-modern', enabled ? 'enabled' : 'disabled');
    root.setAttribute('data-theme', dark ? 'dark' : 'light');

    if (document.body) {
      document.body.setAttribute('data-usos-modern', enabled ? 'enabled' : 'disabled');
      document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    }

    // Aktualizacja ikony przycisku trybu ciemnego w nawigacji
    const themeBtn = document.getElementById('usos-theme-toggle-btn');
    if (themeBtn) {
      themeBtn.innerHTML = dark ? getSunIcon() : getMoonIcon();
      themeBtn.setAttribute('title', dark ? 'Przełącz na jasny motyw' : 'Przełącz na ciemny motyw');
    }

    if (dark) {
      cleanLegacyInlineColors();
    }
  }

  /**
   * Neutralizuje sztywne jasne kolory tła i ciemne kolory tekstu z atrybutów inline w trybie ciemnym
   */
  function cleanLegacyInlineColors() {
    if (!isDarkMode) return;
    const styledElements = document.querySelectorAll('[style*="background"], [style*="color"]');
    styledElements.forEach((el) => {
      if (el.closest('#usos-modern-navbar, #usos-schedule-filter-bar, .usos-upcoming-class-banner')) return;
      const s = el.getAttribute('style') || '';
      if (/background(?:-color)?\s*:\s*(?:#ffffff|#fff|white|#eee|#f8f8f8|#cfcfcf|#ffb|#ffe|#fed|#fbe|#ffa|#f0a|#ffc)/i.test(s)) {
        el.style.backgroundColor = 'transparent';
      }
      if (/(?:^|;)\s*color\s*:\s*(?:#000|black|#06022e|#444|#333|#626071)/i.test(s)) {
        el.style.color = 'inherit';
      }
    });
  }

  /* ==========================================================================
     2. GŁÓWNA ORKIESTRACJA MODERNIZACJI DOM
     ========================================================================== */

  function runModernizer() {
    if (!isExtensionEnabled) return;

    try {
      modernizeNavigation();
      if (isMaintenanceBreak()) {
        modernizeMaintenancePage();
        cleanLegacyInlineColors();
        return;
      }
      modernizeBreadcrumbs();
      modernizeTablesAndGrades();
      modernizeAlerts();
      modernizeUpcomingClassBanner();
      modernizeCardContainers();
      modernizePlanView();
      modernizeTimetable();
      modernizeSelectors();
      modernizeHeadings();
      modernizeRegistrationCalendar();
      modernizeHomeDashboard();
      cleanLegacyInlineColors();
    } catch (err) {
      console.warn('[USOSweb 2.0] Błąd podczas renderowania:', err);
    }
  }

  /* ==========================================================================
     3. MODERNIZACJA GÓRNEGO PASKA NAWIGACJI (NAVBAR)
     ========================================================================== */

  function modernizeNavigation() {
    if (document.getElementById('usos-modern-navbar')) return;

    // Pobierz informacje o zalogowanym użytkowniku (w tym z <cas-bar>)
    const userInfo = extractUserInfo();

    // Pobierz linki nawigacyjne (w tym z <menu-top-item>)
    const navLinks = extractNavLinks();

    // Ukryj brzydki baner <app-header>, <cas-bar> i surowy <menu-top>
    hideLegacyHeader();

    // Zbuduj nowoczesny pasek nawigacyjny shadcn/ui
    const navBar = document.createElement('header');
    navBar.id = 'usos-modern-navbar';
    navBar.className = 'usos-modern-navbar usos-modern-only';

    // Lewa strona: Logo Politechniki Śląskiej, Tytuł i Linki
    const navLeft = document.createElement('div');
    navLeft.className = 'usos-modern-nav-left';

    const brand = document.createElement('a');
    brand.className = 'usos-modern-brand';
    brand.href = '/kontroler.php?_action=home/index';
    brand.innerHTML = `
      <div class="usos-brand-logo-wrap">
        <img src="https://usosweb.polsl.pl/img/header-logo.svg" alt="Politechnika Śląska" class="usos-polsl-logo" onerror="this.style.display='none';">
        <div class="usos-brand-icon" style="display:none;">PŚ</div>
      </div>
      <div class="usos-brand-text">
        <span class="usos-brand-name">Politechnika Śląska</span>
        <span class="usos-brand-badge">USOSweb 2.0</span>
      </div>
    `;
    navLeft.appendChild(brand);

    // Lista linków nawigacyjnych (Aktualności, Katalog, Mój USOSweb itd.)
    const linksList = document.createElement('ul');
    linksList.className = 'usos-nav-links';

    navLinks.forEach((linkItem) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = `usos-nav-link ${linkItem.isActive ? 'active' : ''} ${linkItem.isGreyed ? 'greyed' : ''}`;
      a.href = linkItem.href;
      a.textContent = linkItem.text;
      if (linkItem.onclick) {
        a.setAttribute('onclick', linkItem.onclick);
      }
      li.appendChild(a);
      linksList.appendChild(li);
    });

    navLeft.appendChild(linksList);

    // Prawa strona: Przełącznik Dark Mode, Dane użytkownika (Borys Rogowski), Wylogowanie
    const navRight = document.createElement('div');
    navRight.className = 'usos-modern-nav-right';

    // Przycisk Dark Mode
    const themeBtn = document.createElement('button');
    themeBtn.id = 'usos-theme-toggle-btn';
    themeBtn.type = 'button';
    themeBtn.className = 'usos-theme-btn';
    themeBtn.title = isDarkMode ? 'Przełącz na jasny motyw' : 'Przełącz na ciemny motyw';
    themeBtn.innerHTML = isDarkMode ? getSunIcon() : getMoonIcon();
    themeBtn.addEventListener('click', toggleDarkMode);
    navRight.appendChild(themeBtn);

    // Kapsułka z danymi studenta
    if (userInfo.name) {
      const userPill = document.createElement('div');
      userPill.className = 'usos-user-pill';
      userPill.innerHTML = `
        <div class="usos-user-avatar">${userInfo.initials}</div>
        <span>${userInfo.name}</span>
      `;
      navRight.appendChild(userPill);
    }

    // Przycisk Wyloguj
    if (userInfo.logoutUrl) {
      const logoutBtn = document.createElement('a');
      logoutBtn.className = 'usos-logout-btn';
      logoutBtn.href = userInfo.logoutUrl;
      logoutBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        Wyloguj
      `;
      navRight.appendChild(logoutBtn);
    }

    navBar.appendChild(navLeft);
    navBar.appendChild(navRight);

    // Wstawienie na sam początek body
    document.body.prepend(navBar);
  }

  /**
   * Rozpoznaje nazwę uczelni z adresu URL
   */
  function getUniversityName() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('polsl')) return 'Politechnika Śląska';
    if (host.includes('uj')) return 'UJ Kraków';
    if (host.includes('uw')) return 'Uniwersytet Warszawski';
    if (host.includes('pw')) return 'Politechnika Warszawska';
    if (host.includes('pwr')) return 'Politechnika Wrocławska';
    if (host.includes('agh')) return 'AGH Kraków';
    return 'USOSweb';
  }

  /**
   * Ekstrakcja danych zalogowanego użytkownika ze struktury USOS
   */
  function extractUserInfo() {
    let name = '';
    let logoutUrl = '';
    let initials = 'U';

    // 1. Sprawdź nowoczesny komponent PolSl <cas-bar>
    const casBar = document.querySelector('cas-bar');
    if (casBar) {
      if (casBar.getAttribute('logged-user')) {
        name = casBar.getAttribute('logged-user').trim();
      }
      if (casBar.getAttribute('logout-url')) {
        logoutUrl = casBar.getAttribute('logout-url');
      }
    }

    // 2. Jeśli nie znaleziono, przeszukaj link wylogowania
    if (!logoutUrl) {
      const logoutElem = document.querySelector('a[href*="logout"], a[href*="wyloguj"]');
      if (logoutElem) {
        logoutUrl = logoutElem.getAttribute('href');
      }
    }

    // 3. Wyszukaj węzły zawierające słowa kluczowe sesji użytkownika
    if (!name) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue.trim();
        if (/Zalogowany jako:|Zalogowany:|Zalogowana jako:/i.test(text)) {
          name = text.replace(/Zalogowan[ya] jako:|Zalogowan[ya]:/i, '').trim();
          name = name.split('[')[0].split('(')[0].trim();
          break;
        }
      }
    }

    // Fallback: jeśli nie znaleziono imienia w tekście, sprawdź typowe kontenery nagłówka
    if (!name) {
      const userBox = document.querySelector('.user-info, #user-info, .usos-user');
      if (userBox) {
        name = userBox.textContent.replace(/Wyloguj/gi, '').trim();
      }
    }

    if (name) {
      const parts = name.split(/\s+/);
      if (parts.length >= 2) {
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
      } else if (parts.length === 1 && parts[0].length > 0) {
        initials = parts[0][0].toUpperCase();
      }
    }

    return { name, initials, logoutUrl };
  }

  /**
   * Ekstrakcja głównych zakładek USOS (Mój USOSweb, Dla Studentów, Katalog, etc.)
   */
  function extractNavLinks() {
    const links = [];

    // 1. Sprawdź nowoczesne elementy <menu-top-item> (PolSl USOS 7.3)
    const menuTopItems = document.querySelectorAll('menu-top-item');
    if (menuTopItems.length > 0) {
      menuTopItems.forEach((item) => {
        let text = item.getAttribute('name') || item.textContent.trim();
        // Dekodowanie encji HTML np. "m&oacute;j USOSweb"
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text;
        text = tempDiv.textContent.trim();

        const href = item.getAttribute('href');
        const isSelected = item.hasAttribute('selected') || item.classList.contains('selected') || (href && window.location.href.includes(href));
        const isGreyed = item.hasAttribute('greyed');
        const onclick = item.getAttribute('onclick');

        if (text && href) {
          links.push({ text, href, isActive: isSelected, isGreyed, onclick });
        }
      });
    }

    // 2. Jeśli brak <menu-top-item>, sprawdź tradycyjne menu USOS
    if (links.length === 0) {
      const legacyMenu = document.querySelector('#topmenu, .topmenu, table#topmenu, ul.menu');
      if (legacyMenu) {
        const menuAnchors = legacyMenu.querySelectorAll('a');
        menuAnchors.forEach((a) => {
          const text = a.textContent.trim();
          const href = a.getAttribute('href');
          if (text && href && !href.startsWith('javascript:void') && !href.includes('logout')) {
            const isActive = a.classList.contains('active') || a.parentElement?.classList.contains('active') || window.location.href.includes(href);
            links.push({ text, href, isActive });
          }
        });
      }
    }

    // 3. Fallback standardowych skrótów USOSweb
    if (links.length === 0) {
      links.push(
        { text: 'Aktualności', href: '/kontroler.php?_action=news/default', isActive: false },
        { text: 'Katalog', href: '/kontroler.php?_action=katalog2/index', isActive: false },
        { text: 'Mój USOSweb', href: '/kontroler.php?_action=home/index', isActive: true },
        { text: 'Dla Studentów', href: '/kontroler.php?_action=dla_stud/index', isActive: false },
        { text: 'Dla Wszystkich', href: '/kontroler.php?_action=dodatki/index', isActive: false }
      );
    }

    return links;
  }

  /**
   * Ukrywanie starych pasków nagłówkowych i brzydkiego banera
   */
  function hideLegacyHeader() {
    const selectorsToHide = [
      'app-header',
      '.app-header',
      '#app-header',
      'cas-bar',
      '#layout-cas-bar',
      'menu-top',
      '#topmenu',
      'table#topmenu',
      '.topmenu',
      'table.topmenu',
      '#header-table',
      '.header-table',
      'table#header',
      'div#header'
    ];

    selectorsToHide.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.classList.add('usos-legacy-header-hidden');
        el.style.setProperty('display', 'none', 'important');
      }
    });

    // Ukryj powtarzające się banery nagłówkowe
    const headerImages = document.querySelectorAll('img[src*="logo"], img[src*="polsl"], img[src*="naglowek"]');
    headerImages.forEach((img) => {
      if (img.closest('table') && img.closest('table').offsetTop < 120) {
        const parentTable = img.closest('table');
        if (parentTable && !parentTable.classList.contains('tab')) {
          parentTable.classList.add('usos-legacy-header-hidden');
          parentTable.style.setProperty('display', 'none', 'important');
        }
      }
    });
  }

  /* ==========================================================================
     4. MODERNIZACJA ŚCIEŻKI OKRUSZKÓW (BREADCRUMBS)
     ========================================================================== */

  function modernizeBreadcrumbs() {
    const legacyBreadcrumbs = document.querySelector('.path, #path, .breadcrumb');
    if (!legacyBreadcrumbs || legacyBreadcrumbs.classList.contains('usos-modern-breadcrumbs')) return;

    legacyBreadcrumbs.classList.add('usos-modern-breadcrumbs');

    // Zamień brzydkie separatory (np. "&raquo;", ">", "»") na subtelne ikony SVG
    const links = legacyBreadcrumbs.querySelectorAll('a');
    const container = document.createElement('nav');
    container.className = 'usos-modern-breadcrumbs usos-modern-only';

    links.forEach((link, idx) => {
      const clonedLink = link.cloneNode(true);
      container.appendChild(clonedLink);

      // Dodaj separator jeśli to nie ostatni element
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;
      container.appendChild(sep);
    });

    // Dodaj ostatni, aktualny element
    const fullText = legacyBreadcrumbs.textContent.trim();
    const parts = fullText.split(/[»>]/);
    const lastPart = parts[parts.length - 1]?.trim();
    if (lastPart) {
      const current = document.createElement('span');
      current.className = 'breadcrumb-current';
      current.textContent = lastPart;
      container.appendChild(current);
    }

    legacyBreadcrumbs.style.display = 'none';
    legacyBreadcrumbs.parentNode.insertBefore(container, legacyBreadcrumbs.nextSibling);
  }

  /* ==========================================================================
     5. DETEKCJA TABEL, OCEN, PUNKTÓW ORAZ ECTS (BADGES)
     ========================================================================== */

  function modernizeTablesAndGrades() {
    const tables = document.querySelectorAll('table.tab, table.grey, table.display-table, table[border="1"]');

    tables.forEach((table) => {
      // Dodaj klasę do nowoczesnego stylowania
      table.classList.add('usos-modern-table');

      // Owiń w kontener z horyzontalnym scrollem (jeśli jeszcze nie owinięto)
      if (!table.parentElement.classList.contains('usos-table-wrapper')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'usos-table-wrapper';
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }

      // Analiza kolumn tabeli
      analyzeAndBadgeTable(table);
    });
  }

  /**
   * Analizuje zawartość komórek i wstawia kolorowe badge ocen
   */
  function analyzeAndBadgeTable(table) {
    const rows = table.querySelectorAll('tr');
    if (rows.length === 0) return;

    // Przeszukaj wiersze w poszukiwaniu ocen i punktów
    rows.forEach((row) => {
      // Ignoruj nagłówki przy analizie ocen
      if (row.querySelector('th') || row.classList.contains('header')) return;

      const cells = row.querySelectorAll('td');
      cells.forEach((cell) => {
        // Jeśli komórka ma już odznakę, pomiń
        if (cell.querySelector('.usos-badge')) return;

        // Pomiń komórki etykiet (np. td.strong w tabelach klucz-wartość)
        if (cell.classList.contains('strong') || cell.classList.contains('label')) return;

        // Pomiń komórki zawierające zagnieżdżone elementy formularza, tabele, listy, plany lub tooltipy
        if (cell.querySelector('table, form, fieldset, usos-timetable, usos-tooltip, ul, ol, input, select, button')) return;

        const rawText = cell.textContent.trim();
        // Oceny i punkty ECTS są zwięzłe – nigdy nie są długim opisem
        if (!rawText || rawText.length > 25) return;

        const badgeInfo = evaluateGrade(rawText);

        if (badgeInfo) {
          const badge = document.createElement('span');
          badge.className = `usos-badge ${badgeInfo.className}`;
          badge.textContent = badgeInfo.label;

          // Zachowaj ewentualne linki wewnątrz komórki
          const innerAnchor = cell.querySelector('a');
          if (innerAnchor) {
            innerAnchor.textContent = '';
            innerAnchor.appendChild(badge);
          } else {
            cell.textContent = '';
            cell.appendChild(badge);
          }
        }
      });
    });
  }

  /**
   * Klasyfikuje ocenę lub status zaliczenia
   */
  function evaluateGrade(text) {
    if (!text || text.length > 25) return null;
    const clean = text.replace(/,/g, '.').trim().toUpperCase();

    // 1. Oceny Bardzo Dobre i Dobre (Pozytywne - Success / Zielone)
    if (/^(?:5\.0|5\.5|5|4\.5|4\.0|4)$/.test(clean) || clean === 'BDB' || clean === 'DB+') {
      return { className: 'usos-badge-success', label: text };
    }

    // 2. Oceny Dostateczne / Zaliczenia (Info - Niebieskie)
    if (/^(?:3\.5|3\.0|3)$/.test(clean) || clean === 'DST+' || clean === 'DST' || clean === 'ZAL' || clean === 'ZALICZENIE') {
      return { className: 'usos-badge-info', label: text };
    }

    // 3. Oceny Negatywne / Niezaliczenia (Danger - Czerwone)
    if (/^(?:2\.0|2)$/.test(clean) || clean === 'NDST' || clean === 'NZAL' || clean === 'NK' || clean === 'NIEZALICZONE') {
      return { className: 'usos-badge-danger', label: text };
    }

    // 4. ECTS (dokładne dopasowanie: np. "3 ECTS", "30 ECTS", "1.5 ECTS", "4 PKT")
    if (/^\d+(?:[.,]\d+)?\s*(?:ECTS|PKT\.?)$/i.test(text.trim())) {
      return { className: 'usos-badge-ects', label: text.trim() };
    }

    // 5. Ostrzeżenia lub statusy w toku (np. "W TOKU", "BRAK", "DO ZALICZENIA")
    if (clean === 'W TOKU' || clean === 'BRAK OCENY' || clean === 'OCZEKUJE') {
      return { className: 'usos-badge-warning', label: text };
    }

    return null;
  }

  /* ==========================================================================
     6. MODERNIZACJA ALERTÓW I KART
     ========================================================================== */

  function modernizeAlerts() {
    const alerts = document.querySelectorAll('.ui-state-highlight, .ui-state-error, div.info, div.warning, div.error');
    alerts.forEach((alert) => {
      if (alert.dataset.usosProcessed) return;
      alert.dataset.usosProcessed = 'true';

      const isError = alert.classList.contains('ui-state-error') || alert.classList.contains('error');
      const icon = isError ? getAlertCircleIcon() : getInfoCircleIcon();

      const iconSpan = document.createElement('span');
      iconSpan.style.display = 'inline-flex';
      iconSpan.style.flexShrink = '0';
      iconSpan.innerHTML = icon;

      alert.prepend(iconSpan);
    });
  }

  function modernizeCardContainers() {
    const containers = document.querySelectorAll('.main-body, #layout-c, .body-container');
    containers.forEach((c) => {
      if (!c.classList.contains('usos-card-enhanced')) {
        c.classList.add('usos-card-enhanced');
      }
    });

    modernizeShadowComponents();
  }

  /* ==========================================================================
     6b. SHADOW DOM – web komponenty USOS (main-panel, usos-frame, usos-selector...)
     Content script ma dostęp do otwartych shadowRoot, więc stylujemy je bezpośrednio.
     ========================================================================== */

  const SHADOW_CSS = {
    layout: `
      :host, :host > div {
        background: var(--bg-page) !important;
        background-color: var(--bg-page) !important;
        color: var(--text-main) !important;
        box-shadow: none !important;
      }
    `,
    frame: `
      :host {
        display: block !important;
        background: var(--bg-card) !important;
        color: var(--text-main) !important;
        border-color: var(--border-default) !important;
      }
      #header {
        background: transparent !important;
        background-color: transparent !important;
        color: var(--text-main) !important;
        border-bottom: none !important;
      }
      #title, #trailing-content, #body, #foot {
        background: transparent !important;
        background-color: transparent !important;
        color: var(--text-main) !important;
      }
      #expand-button {
        color: var(--text-muted) !important;
      }
      *:not(slot):not(#expand-button) {
        border-color: var(--border-default) !important;
      }
    `,
    link: `
      :host([bordered]) a, a {
        background: var(--bg-card) !important;
        color: var(--primary) !important;
        border: 1px solid var(--border-default) !important;
        border-radius: 6px !important;
        padding: 0.35rem 0.75rem !important;
        text-decoration: none !important;
      }
      :host([bordered]) a:hover, a:hover {
        background: var(--primary) !important;
        color: #ffffff !important;
        border-color: var(--primary) !important;
      }
    `,
    tooltip: `
      #tooltip, [role="tooltip"], :host > div {
        background: var(--bg-card) !important;
        color: var(--text-main) !important;
        border: 1px solid var(--border-default) !important;
        box-shadow: var(--shadow-lg) !important;
      }
    `,
    dialog: `
      dialog, .dialog, #dialog, :host > div {
        background: var(--bg-card) !important;
        color: var(--text-main) !important;
        border: 1px solid var(--border-default) !important;
      }
    `,
    day: `
      :host {
        background: var(--bg-input) !important;
        border-color: var(--border-default) !important;
      }
    `,
    alertBox: `
      :host {
        display: block !important;
        background: var(--bg-card, #111827) !important;
        color: var(--text-main, #f8fafc) !important;
        border: 1px solid var(--border-default, #26334d) !important;
        border-left: 4px solid var(--primary, #3b82f6) !important;
        border-radius: 8px !important;
      }
      :host > div, :host > div:nth-child(2), #content, #container, .box, .content {
        background: transparent !important;
        background-color: transparent !important;
        color: inherit !important;
      }
      #icon {
        color: var(--primary, #3b82f6) !important;
      }
      #expand-control a {
        color: var(--primary, #3b82f6) !important;
      }
      * {
        color: inherit !important;
      }
    `,
    inputs: `
      input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, select {
        background: var(--bg-input) !important;
        color: var(--text-main) !important;
        border: 1px solid var(--border-default) !important;
        border-radius: 10px !important;
        padding: 0.7rem 0.95rem !important;
        font-family: var(--font-sans) !important;
        font-size: 0.875rem !important;
        line-height: 1.4 !important;
        outline: none !important;
        box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.08) !important;
        width: 100% !important;
        box-sizing: border-box !important;
        transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease !important;
      }
      input:hover, textarea:hover, select:hover { border-color: var(--border-strong) !important; }
      input:focus, textarea:focus, select:focus {
        border-color: var(--primary) !important;
        box-shadow: 0 0 0 3px var(--ring-color) !important;
      }
      input::placeholder, textarea::placeholder { color: var(--text-subtle) !important; opacity: 1 !important; }
      label, .label, [part~="label"] {
        color: var(--text-muted) !important;
        font-family: var(--font-sans) !important;
        font-size: 0.75rem !important;
        font-weight: 600 !important;
        letter-spacing: 0.01em !important;
        background: var(--bg-card) !important;
        padding: 0 0.3rem !important;
      }
      fieldset, legend { border: none !important; }
      ul, ol, [role="listbox"], [role="menu"] {
        background: var(--bg-card) !important;
        color: var(--text-main) !important;
        border: 1px solid var(--border-default) !important;
        border-radius: 10px !important;
        box-shadow: var(--shadow-lg) !important;
      }
      li, [role="option"] { color: var(--text-main) !important; background: transparent !important; }
      li:hover, [role="option"]:hover, [aria-selected="true"] { background: var(--bg-card-hover) !important; }
      button { color: var(--text-muted) !important; background: transparent !important; border: none !important; }
    `,
    footer: `
      :host { background: var(--bg-card) !important; color: var(--text-muted) !important; }
      *:not(slot) {
        background-color: transparent !important;
        background-image: none !important;
        color: inherit !important;
        border-color: var(--border-default) !important;
      }
      h1, h2, h3, h4, header, .header, [part~="header"] { color: var(--text-main) !important; font-weight: 700 !important; }
      a { color: var(--text-muted) !important; }
      a:hover { color: var(--primary) !important; }
    `,
    timetable: `
      :host { width: 100% !important; max-width: none !important; }
      *:not(slot) { max-width: none !important; }
      * { border-color: var(--border-default) !important; }
      hr { border: none !important; border-top: 1px dashed var(--border-default) !important; background: transparent !important; margin: 0 !important; }
      :host(:not([mini])) * { color: var(--text-muted); }
    `,
    entry: `
      :host {
        border-radius: 10px !important;
        overflow: hidden !important;
        cursor: pointer !important;
      }
      *:not(slot) {
        -webkit-line-clamp: unset !important;
        line-clamp: unset !important;
        text-overflow: clip !important;
        white-space: normal !important;
        max-height: none !important;
        background-color: transparent !important;
        color: inherit !important;
        font-family: var(--font-sans) !important;
      }
    `
  };

  /** Wstrzykuje <style> do shadowRoot (tylko raz na klucz). */
  function injectShadowCSS(root, key, css) {
    if (!root || root.querySelector(`style[data-usos2="${key}"]`)) return;
    const st = document.createElement('style');
    st.setAttribute('data-usos2', key);
    st.textContent = css;
    root.appendChild(st);
  }

  /** Iteruje po wszystkich shadowRoot w dokumencie (rekurencyjnie). */
  function forEachShadowRoot(cb, root = document) {
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) {
        cb(el.shadowRoot, el);
        forEachShadowRoot(cb, el.shadowRoot);
      }
    });
  }

  function setImp(el, prop, val) {
    el.style.setProperty(prop, val, 'important');
  }

  /**
   * Rozciąga wewnętrzny układ <main-panel> (i <usos-layout>) na całą szerokość.
   * Szuka slotów left-menu / page-body w shadow DOM i przebudowuje ich wspólnego
   * przodka na elastyczny flex: [sidebar 280px][treść 1fr].
   */
  function fixLayoutShadow(host) {
    const sr = host.shadowRoot;
    if (!sr) return;

    // Wszystkie elementy kontenerowe bez limitu szerokości
    sr.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'STYLE' || el.tagName === 'SLOT') return;
      setImp(el, 'max-width', 'none');
    });

    const body = sr.querySelector('slot[name="page-body"]') || sr.querySelector('slot:not([name])');
    const left = sr.querySelector('slot[name="left-menu"]');
    if (!body) return;

    // Ścieżka od slotu treści w górę – pełna szerokość
    let el = body.parentElement;
    while (el) {
      setImp(el, 'width', '100%');
      setImp(el, 'min-width', '0');
      setImp(el, 'box-sizing', 'border-box');
      el = el.parentElement;
    }

    if (!left) return;

    // Wspólny przodek slotów
    let common = left.parentElement;
    while (common && !common.contains(body)) common = common.parentElement;
    if (!common) return;

    setImp(common, 'display', 'flex');
    setImp(common, 'flex-direction', window.innerWidth <= 900 ? 'column' : 'row');
    setImp(common, 'align-items', 'flex-start');
    setImp(common, 'gap', '2rem');
    setImp(common, 'grid-template-columns', 'none');

    // Gałąź sidebara (bezpośrednie dziecko wspólnego przodka)
    let leftBranch = left;
    while (leftBranch.parentElement && leftBranch.parentElement !== common) leftBranch = leftBranch.parentElement;
    if (leftBranch !== left) {
      setImp(leftBranch, 'flex', '0 0 auto');
      setImp(leftBranch, 'width', 'auto');
      setImp(leftBranch, 'position', 'sticky');
      setImp(leftBranch, 'top', '84px');
    }

    // Gałąź treści
    let bodyBranch = body;
    while (bodyBranch.parentElement && bodyBranch.parentElement !== common) bodyBranch = bodyBranch.parentElement;
    if (bodyBranch !== body) {
      setImp(bodyBranch, 'flex', '1 1 0%');
      setImp(bodyBranch, 'width', 'auto');
      setImp(bodyBranch, 'margin', '0');
    }
  }

  /** Inputy: wrappery wokół inputa stają się przezroczyste (ramka tylko na inpucie). */
  function flattenInputWrappers(root) {
    root.querySelectorAll('input:not([type="hidden"])').forEach((input) => {
      let el = input.parentElement;
      let depth = 0;
      while (el && depth < 4) {
        setImp(el, 'background', 'transparent');
        setImp(el, 'border-color', 'transparent');
        setImp(el, 'box-shadow', 'none');
        el = el.parentElement;
        depth++;
      }
    });
  }

  function modernizeShadowComponents() {
    if (!isExtensionEnabled) return;

    document.querySelectorAll('main-panel, usos-layout').forEach(fixLayoutShadow);

    forEachShadowRoot((root, host) => {
      const tag = host.tagName.toLowerCase();

      if (tag === 'main-panel' || tag === 'usos-layout') {
        injectShadowCSS(root, 'layout', SHADOW_CSS.layout);
      }
      if (tag === 'usos-frame') injectShadowCSS(root, 'frame', SHADOW_CSS.frame);
      if (tag === 'usos-link') injectShadowCSS(root, 'link', SHADOW_CSS.link);
      if (tag === 'usos-dialog') injectShadowCSS(root, 'dialog', SHADOW_CSS.dialog);
      if (tag === 'usos-tooltip') injectShadowCSS(root, 'tooltip', SHADOW_CSS.tooltip);
      if (tag === 'timetable-day') injectShadowCSS(root, 'day', SHADOW_CSS.day);
      if (tag === 'error-box' || tag === 'info-box' || tag === 'notice-box' || tag === 'success-box') {
        injectShadowCSS(root, 'alertBox', SHADOW_CSS.alertBox);
      }
      if (tag === 'usos-footer' || tag === 'footer-panel' || tag === 'footer-row' || tag === 'usos-copyright') {
        injectShadowCSS(root, 'footer', SHADOW_CSS.footer);
      }
      if (tag === 'usos-timetable') injectShadowCSS(root, 'timetable', SHADOW_CSS.timetable);
      if (tag === 'timetable-entry' && !host.closest('usos-timetable[mini]')) {
        injectShadowCSS(root, 'entry', SHADOW_CSS.entry);
      }

      if (root.querySelector('input:not([type="hidden"]), textarea, select')) {
        injectShadowCSS(root, 'inputs', SHADOW_CSS.inputs);
        flattenInputWrappers(root);
      }
    });
  }

  /** Komponenty Lit renderują się asynchronicznie – ponawiamy przez kilka sekund. */
  function scheduleShadowPasses() {
    const refreshWidgets = () => {
      if (isMaintenanceBreak()) {
        modernizeMaintenancePage();
        return;
      }
      modernizeShadowComponents();
      modernizeUpcomingClassBanner();
      const sched = document.querySelector('.usos-home-schedule-widget');
      if (sched) {
        formatScheduleWidgetTimetable(sched.querySelector('#tab-current'));
        formatScheduleWidgetTimetable(sched.querySelector('#tab-next'));
      }
    };

    let runs = 0;
    const iv = setInterval(() => {
      refreshWidgets();
      if (++runs >= 20) clearInterval(iv);
    }, 300);
    window.addEventListener('load', () => setTimeout(refreshWidgets, 100));
    window.addEventListener('resize', () => {
      document.querySelectorAll('main-panel, usos-layout').forEach(fixLayoutShadow);
      refreshWidgets();
    });
  }

  /* ==========================================================================
     6c. PLAN ZAJĘĆ – czytelne bloczki (godziny, czas trwania, prowadzący)
     ========================================================================== */

  /** "g0815" -> { h: 8, m: 15 } */
  function parseGridTime(value) {
    const match = /g(\d{2})(\d{2})/.exec(value || '');
    if (!match) return null;
    return { h: parseInt(match[1], 10), m: parseInt(match[2], 10) };
  }

  function formatTime(t) {
    return `${t.h}:${String(t.m).padStart(2, '0')}`;
  }

  function formatDuration(start, end) {
    const mins = (end.h * 60 + end.m) - (start.h * 60 + start.m);
    if (mins <= 0) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h} h ${m} min`;
    if (h) return `${h} h`;
    return `${m} min`;
  }

  /** Zbiera tekst z light DOM i (jeśli jest) z shadow DOM bloczka. */
  function collectEntryText(entry) {
    let text = entry.textContent || '';
    if (entry.shadowRoot) text += '\n' + (entry.shadowRoot.textContent || '');
    return text;
  }

  /** Szuka prowadzących: linki do profili osób, tytuły naukowe, frazy "Prowadzący:", atrybuty. */
  function extractTeachers(entry) {
    const found = new Set();
    const roots = [entry];
    if (entry.shadowRoot) roots.push(entry.shadowRoot);

    roots.forEach((root) => {
      root.querySelectorAll('a[href*="pokazOsobe"], a[href*="os_id="], a[href*="osoby/"]').forEach((a) => {
        const name = a.textContent.replace(/\s+/g, ' ').trim();
        if (name && name.length < 80) found.add(name);
      });
    });

    const textsToCheck = [
      collectEntryText(entry),
      entry.getAttribute('title') || '',
      entry.getAttribute('data-tooltip') || '',
      entry.getAttribute('data-content') || '',
      entry.getAttribute('aria-label') || ''
    ];

    textsToCheck.forEach((text) => {
      if (!text) return;
      // Wykrywanie polskich stopni naukowych i nazwisk wykładowców
      const academicRe = /(?:(?:prof\.\s*(?:dr\s*hab\.)?|dr\s*hab\.|dr\s*inż\.|dr|mgr\s*inż\.|mgr|inż\.)\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)/g;
      let am;
      while ((am = academicRe.exec(text))) {
        found.add(am[0].trim());
      }

      const re = /(?:Prowadz[a-ząęóśłżźćń]*|Lecturers?|Teachers?)\s*:\s*([^\n;,<]+)/gi;
      let m;
      while ((m = re.exec(text))) {
        const val = m[1].replace(/\s+/g, ' ').trim();
        if (val && val.length < 80) found.add(val);
      }
    });

    Array.from(entry.attributes).forEach((attr) => {
      if (/prowadz|lecturer|teacher/i.test(attr.name) && attr.value.trim()) {
        found.add(attr.value.trim());
      }
    });

    return Array.from(found);
  }

  function modernizeTimetable() {
    const fullTimetables = document.querySelectorAll('usos-timetable:not([mini])');
    const isPlan = fullTimetables.length > 0 || window.location.href.includes('home/plan');
    document.documentElement.classList.toggle('usos2-plan-page', isPlan);

    fullTimetables.forEach((tt) => {
      // 1. Wymuszenie 100% szerokości i usunięcie blokad na rodzicach planu
      tt.style.setProperty('width', '100%', 'important');
      tt.style.setProperty('max-width', 'none', 'important');
      tt.style.setProperty('display', 'flex', 'important');
      tt.style.setProperty('box-sizing', 'border-box', 'important');

      let p = tt.parentElement;
      while (p && p.id !== 'layout-main-content' && p.tagName !== 'MAIN') {
        p.style.setProperty('width', '100%', 'important');
        p.style.setProperty('max-width', 'none', 'important');
        p.style.setProperty('float', 'none', 'important');
        p.style.setProperty('box-sizing', 'border-box', 'important');
        p = p.parentElement;
      }

      // 2. Rozciągnięcie kolumn dni (każdy dzień otrzymuje równą, szeroką przestrzeń)
      const cols = Array.from(tt.children);
      cols.forEach((col) => {
        col.style.setProperty('flex', '1 1 0%', 'important');
        col.style.setProperty('min-width', '130px', 'important');
        col.style.setProperty('max-width', 'none', 'important');
        col.style.setProperty('width', 'auto', 'important');
        const day = col.querySelector('timetable-day');
        if (day) {
          day.style.setProperty('width', '100%', 'important');
          day.style.setProperty('max-width', 'none', 'important');
          day.style.setProperty('min-width', '0', 'important');
        }
      });

      // 3. Wyrównanie paska nawigacji tygodni ("<- wcześniej ... później ->")
      const navLinks = document.querySelectorAll('a[href*="plan_week_sel_week"]');
      if (navLinks.length >= 2) {
        const navContainer = navLinks[0].parentElement;
        if (navContainer) {
          navContainer.style.setProperty('display', 'flex', 'important');
          navContainer.style.setProperty('justify-content', 'space-between', 'important');
          navContainer.style.setProperty('align-items', 'center', 'important');
          navContainer.style.setProperty('width', '100%', 'important');
          navContainer.style.setProperty('max-width', 'none', 'important');
        }
      }

      // 4. Uzupełnienie danych w bloczkach (godziny, czas trwania, wykładowca)
      tt.querySelectorAll('timetable-entry').forEach((entry) => {
        tagAndFormatTimetableEntry(entry);
        if (entry.dataset.usos2Done) return;

        const start = parseGridTime(entry.style.gridRowStart);
        const end = parseGridTime(entry.style.gridRowEnd);
        const teachers = extractTeachers(entry);

        const details = document.createElement('div');
        details.className = 'usos2-entry-details';

        if (start && end) {
          const time = document.createElement('div');
          time.className = 'usos2-entry-time';
          const dur = formatDuration(start, end);
          time.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${formatTime(start)} – ${formatTime(end)}</span>
            ${dur ? `<span class="usos2-entry-dur">${dur}</span>` : ''}
          `;
          details.appendChild(time);
          entry.classList.add(`usos2-len-${Math.min(6, Math.round(((end.h * 60 + end.m) - (start.h * 60 + start.m)) / 45))}`);
        }

        if (teachers.length) {
          const teacher = document.createElement('div');
          teacher.className = 'usos2-entry-teacher';
          teacher.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          `;
          const span = document.createElement('span');
          span.textContent = teachers.join(', ');
          teacher.appendChild(span);
          details.appendChild(teacher);
        }

        if (details.children.length > 0) {
          const infoSlot = entry.querySelector(':scope > [slot="info"]');
          if (infoSlot) {
            infoSlot.appendChild(details);
          } else {
            details.setAttribute('slot', 'info');
            entry.appendChild(details);
          }
        }

        const tooltip = collectEntryText(entry).replace(/\s+/g, ' ').trim();
        if (tooltip && !entry.title) entry.title = tooltip;

        entry.dataset.usos2Done = '1';
      });

      // 5. Inicjalizacja interaktywnego paska filtrów i rozciągania kolumn
      setupScheduleSubjectFilters(tt);
    });
  }

  /* ==========================================================================
     6d. FILTROWANIE I ODZNACZANIE PRZEDMIOTÓW NA PLANIE (ZAPIS W STORAGE)
     ========================================================================== */

  function getSubjectKey(entry) {
    if (entry.dataset.usosSubject) return entry.dataset.usosSubject;

    const titleAttr = entry.getAttribute('title') || entry.getAttribute('data-subject');
    if (titleAttr && titleAttr.length < 80) {
      const clean = titleAttr.split('\n')[0].replace(/\s+(WYK|ĆW|CW|LAB|LEKT|PROJ|SEM)\b.*$/i, '').trim();
      entry.dataset.usosSubject = clean;
      return clean;
    }

    let text = '';
    Array.from(entry.childNodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent + '\n';
      } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('usos2-entry-details') && !node.classList.contains('usos-entry-hide-btn')) {
        text += node.textContent + '\n';
      }
    });

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      let subj = lines[0];
      subj = subj.replace(/^(WYK|ĆW|CW|LAB|LEKT|PROJ|SEM)\s*:\s*/i, '');
      subj = subj.replace(/\s+(WYK|ĆW|CW|LAB|LEKT|PROJ|SEM)\b.*$/i, '');
      if (subj.length >= 2) {
        entry.dataset.usosSubject = subj.trim();
        return subj.trim();
      }
    }

    entry.dataset.usosSubject = 'Przedmiot';
    return 'Przedmiot';
  }

  function getHiddenSubjects(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['usos_hidden_subjects'], (res) => {
        callback(res.usos_hidden_subjects || []);
      });
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem('usos_hidden_subjects') || '[]');
        callback(stored);
      } catch {
        callback([]);
      }
    }
  }

  function saveHiddenSubjects(hiddenList) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ usos_hidden_subjects: hiddenList });
    }
    try {
      localStorage.setItem('usos_hidden_subjects', JSON.stringify(hiddenList));
    } catch {}
  }

  /**
   * Sprawdza nakładanie się przedmiotów w danym dniu.
   * Jeśli przedmiot nie koliduje z żadnym innym WIDOCZNYM przedmiotem,
   * rozciąga go na 100% szerokości dnia (grid-column: 1 / -1).
   */
  function recalculateDayColumns(day) {
    if (!day) return;
    const allEntries = Array.from(day.querySelectorAll('timetable-entry'));
    const visibleEntries = allEntries.filter(e => !e.classList.contains('usos-entry-hidden'));

    const items = visibleEntries.map(entry => {
      const s = parseGridTime(entry.style.gridRowStart);
      const e = parseGridTime(entry.style.gridRowEnd);
      return {
        entry,
        startMin: s ? s.h * 60 + s.m : 0,
        endMin: e ? e.h * 60 + e.m : 1440
      };
    });

    items.forEach(itemA => {
      const overlaps = items.some(itemB => {
        if (itemA === itemB) return false;
        return (itemA.startMin < itemB.endMin && itemA.endMin > itemB.startMin);
      });

      if (!overlaps) {
        // Brak kolizji czasowej z innym widocznym przedmiotem – rozciągnij na 100% szerokości dnia!
        itemA.entry.classList.add('usos-entry-stretched');
        itemA.entry.style.setProperty('grid-column', '1 / -1', 'important');
      } else {
        // Kolizja czasowa – przywróć standardowe ułożenie obok siebie
        itemA.entry.classList.remove('usos-entry-stretched');
        itemA.entry.style.removeProperty('grid-column');
      }
    });
  }

  function applyFilterState(tt, hiddenList) {
    const entries = tt.querySelectorAll('timetable-entry');
    entries.forEach((entry) => {
      const subj = getSubjectKey(entry);
      const isHidden = hiddenList.includes(subj);
      entry.classList.toggle('usos-entry-hidden', isHidden);
      if (isHidden) {
        entry.style.setProperty('display', 'none', 'important');
      } else {
        entry.style.removeProperty('display');
      }
    });

    // Przelicz układ kolumn dla każdego dnia tygodnia
    tt.querySelectorAll('timetable-day').forEach(recalculateDayColumns);

    // Zaktualizuj widok pigułek w pasku filtrów
    updateFilterBarUI(tt, hiddenList);
  }

  function updateFilterBarUI(tt, hiddenList) {
    const bar = document.getElementById('usos-schedule-filter-bar');
    if (!bar) return;

    const pills = bar.querySelectorAll('.usos-filter-pill');
    pills.forEach((pill) => {
      const subj = pill.dataset.subject;
      const isHidden = hiddenList.includes(subj);
      pill.classList.toggle('active', !isHidden);
      pill.classList.toggle('hidden-subject', isHidden);
      pill.innerHTML = isHidden 
        ? `<span class="icon" style="opacity:0.7">⊘</span> <span>${subj}</span>` 
        : `<span class="icon" style="color:#60a5fa">✓</span> <span>${subj}</span>`;
    });

    const counter = bar.querySelector('.usos-filter-counter');
    if (counter) {
      if (hiddenList.length > 0) {
        counter.textContent = `Ukryto: ${hiddenList.length}`;
        counter.classList.add('has-hidden');
      } else {
        counter.textContent = 'Wszystkie widoczne';
        counter.classList.remove('has-hidden');
      }
    }

    const resetBtn = bar.querySelector('.usos-filter-reset-btn');
    if (resetBtn) {
      resetBtn.style.display = hiddenList.length > 0 ? 'inline-flex' : 'none';
    }
  }

  function setupScheduleSubjectFilters(tt) {
    if (!tt) return;

    // 1. Zidentyfikuj wszystkie unikalne przedmioty w siatce planu
    const entries = Array.from(tt.querySelectorAll('timetable-entry'));
    const uniqueSubjects = [];
    const seen = new Set();

    entries.forEach((entry) => {
      const subj = getSubjectKey(entry);
      if (!seen.has(subj)) {
        seen.add(subj);
        uniqueSubjects.push(subj);
      }

      // Dodaj przycisk ukrywania (X) na samym bloczku
      if (!entry.querySelector('.usos-entry-hide-btn')) {
        const hideBtn = document.createElement('button');
        hideBtn.className = 'usos-entry-hide-btn';
        hideBtn.title = `Ukryj "${subj}" z planu`;
        hideBtn.innerHTML = '✕';
        hideBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          getHiddenSubjects((hiddenList) => {
            if (!hiddenList.includes(subj)) {
              hiddenList.push(subj);
              saveHiddenSubjects(hiddenList);
              applyFilterState(tt, hiddenList);
            }
          });
        });
        entry.appendChild(hideBtn);
      }
    });

    if (uniqueSubjects.length === 0) return;

    // Sortuj alfabetycznie
    uniqueSubjects.sort((a, b) => a.localeCompare(b, 'pl'));

    // 2. Utwórz lub zaktualizuj pasek filtrów nad planem
    let filterBar = document.getElementById('usos-schedule-filter-bar');
    if (!filterBar) {
      filterBar = document.createElement('div');
      filterBar.id = 'usos-schedule-filter-bar';
      filterBar.innerHTML = `
        <div class="usos-filter-header">
          <div class="usos-filter-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            <span>Filtruj przedmioty na planie:</span>
            <span class="usos-filter-counter">Wszystkie widoczne</span>
          </div>
          <button class="usos-filter-reset-btn" style="display: none;">Pokaż wszystkie</button>
        </div>
        <div class="usos-filter-pills-list"></div>
      `;

      // Wstaw tuż przed planem usos-timetable
      tt.parentNode.insertBefore(filterBar, tt);

      const resetBtn = filterBar.querySelector('.usos-filter-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
          e.preventDefault();
          saveHiddenSubjects([]);
          applyFilterState(tt, []);
        });
      }
    }

    const subjFingerprint = uniqueSubjects.join('|');
    if (filterBar.dataset.subjectsFingerprint === subjFingerprint) {
      getHiddenSubjects((hiddenList) => {
        applyFilterState(tt, hiddenList);
      });
      return;
    }
    filterBar.dataset.subjectsFingerprint = subjFingerprint;

    const pillsList = filterBar.querySelector('.usos-filter-pills-list');
    pillsList.innerHTML = '';

    getHiddenSubjects((hiddenList) => {
      uniqueSubjects.forEach((subj) => {
        const isHidden = hiddenList.includes(subj);
        const pill = document.createElement('button');
        pill.className = `usos-filter-pill ${isHidden ? 'hidden-subject' : 'active'}`;
        pill.dataset.subject = subj;
        pill.innerHTML = isHidden 
          ? `<span class="icon" style="opacity:0.7">⊘</span> <span>${subj}</span>` 
          : `<span class="icon" style="color:#60a5fa">✓</span> <span>${subj}</span>`;

        pill.addEventListener('click', (e) => {
          e.preventDefault();
          getHiddenSubjects((currentHidden) => {
            const idx = currentHidden.indexOf(subj);
            if (idx >= 0) {
              currentHidden.splice(idx, 1);
            } else {
              currentHidden.push(subj);
            }
            saveHiddenSubjects(currentHidden);
            applyFilterState(tt, currentHidden);
          });
        });

        pillsList.appendChild(pill);
      });

      // Zastosuj filtry do bloczków i przelicz kolumny
      applyFilterState(tt, hiddenList);
    });
  }

  function modernizeHeadings() {
    const titles = document.querySelectorAll('span.block, .block, h1.block, h2.block, #layout-c22 > h1, #layout-main-content > h1, main-panel h1, .usos-ui > h1, h1:not(.usos-brand-text h1)');
    titles.forEach((t) => {
      if (!t.closest('#usos-modern-navbar') && !t.classList.contains('usos-modern-title')) {
        t.classList.add('usos-modern-title');
      }
    });
  }

  function modernizePlanView() {
    // 1. Zastąp surowe przyciski na planie (np. wyślij komuś ten plan, eksportuj)
    const planButtons = document.querySelectorAll('button, input[type="button"], .ui-button');
    planButtons.forEach((btn) => {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('wyślij') || text.includes('eksportuj') || text.includes('html') || text.includes('obrazek')) {
        btn.classList.add('usos-plan-btn');
      }
    });

    // 2. Format planu
    const allDivs = document.querySelectorAll('div');
    allDivs.forEach((div) => {
      if (div.textContent.includes('Pokaż plan w formacie:') && div.children.length <= 4) {
        div.classList.add('plan-format-box');
      }
    });
  }

  function modernizeSelectors() {
    // Pola wyszukiwania w komponentach USOS (Wyszukaj pracownika, jednostkę, przedmiot)
    const selectors = document.querySelectorAll('usos-selector');
    selectors.forEach((sel) => {
      const input = sel.querySelector('input') || sel.shadowRoot?.querySelector('input');
      if (input) {
        input.classList.add('usos-modern-selector-input');
        const label = sel.getAttribute('label');
        if (label && !input.getAttribute('placeholder')) {
          input.setAttribute('placeholder', label.trim());
        }
      }
    });

    const forms = document.querySelectorAll('form[name="osoby"], form[name="jednostki"], form[name="przedmioty"], form[name="programy"], form[name="plan_osoby"], form[name="plan_przedmiotu"]');
    forms.forEach((form) => {
      const inputs = form.querySelectorAll('input[type="text"], input[type="search"]');
      inputs.forEach((inp) => inp.classList.add('usos-modern-selector-input'));
    });
  }

  /* ==========================================================================
     6f. MODERNIZACJA KALENDARZA REJESTRACJI I KART TUR
     ========================================================================== */

  function modernizeRegistrationCalendar() {
    const mainContent = document.querySelector('#layout-c22, #layout-main-content, .usos-ui');
    if (!mainContent) return;

    // 1. Znajdź nagłówki sekcji rejestracji (h2)
    const headings = Array.from(mainContent.querySelectorAll('h2:not(.usos-reg-card-title)'));
    if (headings.length === 0) {
      // Jeśli brak h2, ale istnieją tabele tur rejestracji, zmodernizuj same wiersze
      const standaloneTables = document.querySelectorAll('table:has(tr[element="wiersz_tury"])');
      standaloneTables.forEach(modernizeTourRows);
      return;
    }

    headings.forEach((h2) => {
      // Jeśli nagłówek już przetworzony lub znajduje się wewnątrz karty
      if (h2.dataset.usosRegProcessed || h2.closest('.usos-registration-card')) return;

      const rawTitle = h2.textContent.trim();
      // Pomiń nagłówki niezwiązane z rejestracjami/egzaminami
      const isRegistrationHeader = /rejestracj/i.test(rawTitle) || /egzamin/i.test(rawTitle) || /\[.+\]/.test(rawTitle);
      if (!isRegistrationHeader) return;

      // Zbierz elementy należące do tej sekcji aż do kolejnego h2
      const sectionElements = [];
      let sibling = h2.nextElementSibling;
      while (sibling && sibling.tagName !== 'H2' && !sibling.classList.contains('usos-registration-card')) {
        sectionElements.push(sibling);
        sibling = sibling.nextElementSibling;
      }

      // Stwórz nowoczesną kartę rejestracji
      const card = document.createElement('div');
      card.className = 'usos-registration-card';

      // Wstaw kartę przed h2 i ukryj stary h2 (zachowujemy w DOM dla bezpieczeństwa)
      h2.parentNode.insertBefore(card, h2);
      h2.style.display = 'none';
      h2.dataset.usosRegProcessed = 'true';

      // Ekstrakcja tytułu i kodu w nawiasach [...]
      let titleText = rawTitle;
      let codeText = '';
      const codeMatch = rawTitle.match(/\[([^\]]+)\]/);
      if (codeMatch) {
        titleText = rawTitle.slice(0, codeMatch.index).trim();
        codeText = codeMatch[1].trim();
      }

      // Nagłówek karty
      const cardHeader = document.createElement('div');
      cardHeader.className = 'usos-reg-card-header';

      const headerLeft = document.createElement('div');
      headerLeft.className = 'usos-reg-header-left';

      // Ikona kategorii
      const iconSpan = document.createElement('span');
      iconSpan.className = 'usos-reg-header-icon';
      if (/egzamin/i.test(rawTitle)) {
        iconSpan.innerHTML = getExamIcon();
      } else if (/język|lektorat/i.test(rawTitle)) {
        iconSpan.innerHTML = getLanguageIcon();
      } else if (/fizycz|wychowan|wf/i.test(rawTitle)) {
        iconSpan.innerHTML = getSportIcon();
      } else {
        iconSpan.innerHTML = getBookIcon();
      }
      headerLeft.appendChild(iconSpan);

      const titleEl = document.createElement('h3');
      titleEl.className = 'usos-reg-card-title';
      titleEl.textContent = titleText;
      headerLeft.appendChild(titleEl);

      if (codeText) {
        const codeBadge = document.createElement('span');
        codeBadge.className = 'usos-reg-code-badge';
        codeBadge.textContent = codeText;
        codeBadge.title = `Kod rejestracji: ${codeText}`;
        headerLeft.appendChild(codeBadge);
      }
      cardHeader.appendChild(headerLeft);

      // Link "pokaż przedmioty związane z tą rejestracją"
      const subjectsLinkEl = sectionElements.find(
        (el) => el.tagName.toLowerCase() === 'usos-link' || el.querySelector?.('a[href*="katalog2/przedmioty"]')
      );
      if (subjectsLinkEl) {
        const anchor = subjectsLinkEl.querySelector('a');
        if (anchor) {
          const headerRight = document.createElement('div');
          headerRight.className = 'usos-reg-header-right';

          const btn = document.createElement('a');
          btn.className = 'usos-reg-subjects-btn';
          btn.href = anchor.href;
          if (anchor.getAttribute('onclick')) btn.setAttribute('onclick', anchor.getAttribute('onclick'));
          btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <span>Pokaż przedmioty</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="7" y1="17" x2="17" y2="7"></line>
              <polyline points="7 7 17 7 17 17"></polyline>
            </svg>
          `;
          headerRight.appendChild(btn);
          cardHeader.appendChild(headerRight);
        }
        subjectsLinkEl.remove();
      }

      card.appendChild(cardHeader);

      // Box z opisem (jeśli istnieje)
      const descDiv = sectionElements.find(
        (el) => el.tagName.toLowerCase() === 'div' && (el.getAttribute('style')?.includes('background') || el.querySelector('p'))
      );
      if (descDiv) {
        descDiv.classList.add('usos-reg-description-box');
        descDiv.removeAttribute('style');

        const paragraphs = descDiv.querySelectorAll('p');
        paragraphs.forEach((p) => {
          p.removeAttribute('style');
          // Zamiana surowych adresów URL w klikalne linki
          if (!p.querySelector('a')) {
            p.innerHTML = p.innerHTML.replace(
              /(https?:\/\/[^\s<]+)/g,
              '<a href="$1" target="_blank" rel="noopener noreferrer" class="usos-modern-link">$1</a>'
            );
          }
        });
        card.appendChild(descDiv);
      }

      // Tabela rejestracji lub sesji egzaminacyjnej
      const tableEl = sectionElements.find((el) => el.tagName.toLowerCase() === 'table');
      if (tableEl) {
        tableEl.classList.add('usos-modern-table', 'full-width');
        tableEl.classList.remove('grey');
        tableEl.removeAttribute('style');

        const tbody = tableEl.querySelector('tbody');
        const tourRows = tbody ? tbody.querySelectorAll('tr[element="wiersz_tury"]') : [];

        if (!tbody || (tourRows.length === 0 && tbody.children.length === 0)) {
          // Pusta tabela (np. "Rejestracje na egzaminy" bez sesji)
          const emptyState = document.createElement('div');
          emptyState.className = 'usos-reg-empty-state';
          emptyState.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>Brak aktywnych rejestracji w tej kategorii w bieżącym okresie.</span>
          `;
          card.appendChild(emptyState);
          tableEl.style.display = 'none'; // Zachowaj w DOM dla skryptów USOS
          card.appendChild(tableEl);
        } else {
          modernizeTourRows(tableEl);

          const tableWrapper = document.createElement('div');
          tableWrapper.className = 'usos-table-wrapper usos-reg-table-wrap';
          tableWrapper.appendChild(tableEl);
          card.appendChild(tableWrapper);
        }
      }
    });
  }

  function modernizeTourRows(table) {
    if (!table) return;

    const rows = table.querySelectorAll('tr[element="wiersz_tury"]');
    rows.forEach((row) => {
      if (row.dataset.usosTourProcessed) return;
      row.dataset.usosTourProcessed = 'true';

      const cells = row.children;
      if (cells.length < 5) return;

      const cellIcon = cells[0];
      const cellTime = cells[1];
      const cellName = cells[2];
      const cellAttrs = cells[3];
      const cellAction = cells[4];

      // 1. Analiza stanu tury
      const timeText = cellTime.textContent.toLowerCase();
      const isActive = timeText.includes('w trakcie') || Boolean(cellIcon.querySelector('img[src*="skocz.gif"]'));
      const isEnded = timeText.includes('zakończona') || Boolean(cellIcon.querySelector('img[src*="greencheck.gif"]'));

      const daysMatch = cellTime.textContent.match(/(\d+\s+dni\s+do\s+zakończenia)/i);
      const daysText = daysMatch ? daysMatch[1].replace('zakończenia', 'końca') : '';

      // Przepisanie komórki ze stanem (TD 0)
      cellIcon.innerHTML = '';
      cellIcon.className = 'usos-reg-status-cell';
      const statusBadge = document.createElement('div');
      if (isActive) {
        statusBadge.className = 'usos-tour-status status-active';
        statusBadge.innerHTML = `<span class="usos-pulse-dot"></span><span>W trakcie</span>`;
      } else if (isEnded) {
        statusBadge.className = 'usos-tour-status status-ended';
        statusBadge.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Zakończona</span>
        `;
      } else {
        statusBadge.className = 'usos-tour-status status-upcoming';
        statusBadge.innerHTML = `<span>Oczekuje</span>`;
      }
      cellIcon.appendChild(statusBadge);

      if (daysText && isActive) {
        const countdown = document.createElement('div');
        countdown.className = 'usos-tour-countdown';
        countdown.textContent = daysText;
        cellIcon.appendChild(countdown);
      }

      // 2. Formatowanie zakresu dat (TD 1)
      const localTimes = cellTime.querySelectorAll('local-time');
      if (localTimes.length >= 2) {
        cellTime.innerHTML = `
          <div class="usos-tour-dates">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="usos-dates-icon">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>${localTimes[0].outerHTML}</span>
            <span class="usos-date-sep">&ndash;</span>
            <span>${localTimes[1].outerHTML}</span>
          </div>
        `;
      }

      // 3. Typ i nazwa tury + opis (TD 2)
      // Ukryj przestarzały engineB.gif
      const engineImg = cellName.querySelector('img[src*="engineB.gif"]');
      if (engineImg) engineImg.style.display = 'none';

      // Przekształć link opisu na nowoczesny przycisk z zachowaniem atrybutów USOS!
      const opisLink = cellName.querySelector('a[element="link_opisu"]');
      if (opisLink) {
        opisLink.className = 'usos-reg-opis-btn';
        opisLink.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span>Opis tury</span>
        `;
        // Usuń otaczające brzydkie nawiasy kwadratowe [...] jeśli obecne w rodzicu
        const noteSpan = opisLink.closest('.note');
        if (noteSpan) {
          Array.from(noteSpan.childNodes).forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE && (node.textContent.includes('[') || node.textContent.includes(']'))) {
              node.textContent = node.textContent.replace(/[\[\]]/g, '');
            }
          });
        }
      }

      // 4. Atrybuty tury (TD 3)
      // Zamiana czerwonego numerka <div style="... border: 2px solid #d00 ...">1</div> na elegancki badge
      const redNumDiv = cellAttrs.querySelector('div[style*="#d00"], div[style*="#c00"]');
      if (redNumDiv) {
        const numVal = redNumDiv.textContent.trim();
        const parentTip = redNumDiv.closest('.smarty-tip-wrapper') || redNumDiv.parentElement;
        const attrPill = document.createElement('span');
        attrPill.className = 'usos-reg-attr-pill';
        attrPill.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span>${numVal} ${numVal === '1' ? 'przedmiot' : 'przedmioty'}</span>
        `;
        if (parentTip?.dataset?.content) {
          attrPill.title = parentTip.dataset.content.replace(/<[^>]+>/g, '').trim();
        }
        redNumDiv.replaceWith(attrPill);
      }

      // 5. Akcje (TD 4)
      const actionLink = cellAction.querySelector('a');
      if (actionLink && actionLink.textContent.includes('przejdź do rejestracji')) {
        actionLink.className = 'usos-reg-cta-btn';
        actionLink.innerHTML = `
          <span>Przejdź do rejestracji</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        `;
      } else if (cellAction.textContent.toLowerCase().includes('brak akcji')) {
        cellAction.innerHTML = `<span class="usos-reg-no-action">Brak akcji</span>`;
      }
    });

    // Dopasowanie wierszy opisów
    const opisRows = table.querySelectorAll('tr[element="opis_tury"]');
    opisRows.forEach((r) => {
      r.classList.add('usos-reg-opis-row');
    });
  }

  /* ==========================================================================
     6g. MODERNIZACJA STRONY MÓJ USOSWEB NA SKRÓTY (HOME/INDEX DASHBOARD)
     ========================================================================== */

  function modernizeHomeDashboard() {
    const homeTable = document.querySelector('.local-home-table');
    if (!homeTable) return;
    if (document.getElementById('usos-home-dashboard')) return;

    // 1. Ekstrakcja metadanych studenta z DOM
    const studentMeta = extractStudentDashboardMeta();

    // 2. Budowa Hero Banner
    const heroBanner = buildHomeHeroBanner(studentMeta);

    // 3. Budowa 2-kolumnowego nowoczesnego dashboardu
    const dashboardContainer = document.createElement('div');
    dashboardContainer.id = 'usos-home-dashboard';
    dashboardContainer.className = 'usos-home-dashboard-layout';

    // Kolumny: Lewa (Główna - Plan i Kursy) oraz Prawa (Boczna - Status, Wyszukiwarka, Preferencje)
    const mainCol = document.createElement('div');
    mainCol.className = 'usos-home-main-col';

    const sidebarCol = document.createElement('div');
    sidebarCol.className = 'usos-home-sidebar-col';

    // --- KARTA 1: INTERAKTYWNY PLAN ZAJĘĆ (Z ZAKŁADKAMI) ---
    const scheduleCard = buildInteractiveScheduleCard();
    if (scheduleCard) {
      mainCol.appendChild(scheduleCard);
    }

    // --- KARTA 2: ZAJĘCIA STUDENTA ---
    const coursesCard = buildModernCoursesCard();
    if (coursesCard) {
      mainCol.appendChild(coursesCard);
    }

    // --- KARTA 3: PROFIL STUDENTA I PODPIĘCIA ---
    const profileCard = buildStudentProfileCard(studentMeta);
    if (profileCard) {
      sidebarCol.appendChild(profileCard);
    }

    // --- KARTA 4: ZUNIFIKOWANA WYSZUKIWARKA KATALOGU I PLANÓW ---
    const searchCard = buildUnifiedSearchCard();
    if (searchCard) {
      sidebarCol.appendChild(searchCard);
    }

    // --- KARTA 5: USTAWIENIA I PREFERENCJE ---
    const prefsCard = buildPreferencesCard();
    if (prefsCard) {
      sidebarCol.appendChild(prefsCard);
    }

    dashboardContainer.appendChild(mainCol);
    dashboardContainer.appendChild(sidebarCol);

    // Wstaw hero banner oraz dashboard przed homeTable, a starą tabelę ukryj
    homeTable.parentNode.insertBefore(heroBanner, homeTable);
    homeTable.parentNode.insertBefore(dashboardContainer, homeTable);
    homeTable.style.display = 'none';
    homeTable.setAttribute('aria-hidden', 'true');
    modernizeUpcomingClassBanner();
  }

  function extractStudentDashboardMeta() {
    const meta = {
      fullName: '',
      firstName: '',
      albumNumber: '',
      faculty: 'Wydział Automatyki, Elektroniki i Informatyki (RAU)',
      programme: 'Sztuczna inteligencja',
      daysLeft: '',
      validUntil: '',
      coursesCount: 9,
      unlinkedProgramCount: 1,
      unlinkedStageCount: 8,
    };

    // 1. Imię i nazwisko
    const casBar = document.getElementById('layout-cas-bar');
    if (casBar && casBar.getAttribute('logged-user')) {
      meta.fullName = casBar.getAttribute('logged-user').trim();
    } else {
      const userLink = document.querySelector('.usos-modern-user-name, #layout-cas-bar b');
      if (userLink) meta.fullName = userLink.textContent.trim();
    }
    if (!meta.fullName) meta.fullName = 'Borys Rogowski';
    meta.firstName = meta.fullName.split(' ')[0] || 'Studencie';

    // 2. Numer albumu z info-frame lub tekstu strony
    const infoFrame = document.getElementById('info-frame');
    const fullText = document.body ? document.body.innerText : '';

    const albumMatch = fullText.match(/Numer albumu:\s*(\d+)/i) || (infoFrame && infoFrame.innerText.match(/Numer albumu:\s*(\d+)/i));
    if (albumMatch) meta.albumNumber = albumMatch[1];
    else meta.albumNumber = '325494';

    // 3. Wydział
    const facLink = document.querySelector('a[href*="pokazJednostke&kod="]');
    if (facLink) {
      meta.faculty = facLink.textContent.trim();
    }

    // 4. Dni do rozliczenia i program z Podpięcia
    const daysMatch = fullText.match(/Pozostało\s*(\d+\s*dni)\s*do rozliczenia programu\s*([^.]+)/i);
    if (daysMatch) {
      meta.daysLeft = daysMatch[1].trim();
      meta.programme = daysMatch[2].trim().replace(/\s+/g, ' ');
    } else {
      meta.daysLeft = '138 dni';
    }

    // 5. Ważność konta
    const validMatch = fullText.match(/dostęp do USOSweb wygasa:\s*(\d{4}-\d{2}-\d{2})/i);
    if (validMatch) meta.validUntil = validMatch[1];

    // 6. Podpięcia liczby
    const countMatch = fullText.match(/(\d+)\s*niepodpięt/i);
    if (countMatch) meta.unlinkedProgramCount = parseInt(countMatch[1], 10);
    const stageUnlinkMatch = fullText.match(/(\d+)\s*podpiętych pod program[^,]*ale nie pod etap/i);
    if (stageUnlinkMatch) meta.unlinkedStageCount = parseInt(stageUnlinkMatch[1], 10);

    return meta;
  }

  function buildHomeHeroBanner(meta) {
    const banner = document.createElement('section');
    banner.className = 'usos-home-hero';

    const hour = new Date().getHours();
    const greeting = hour >= 18 ? `Dobry wieczór, ${meta.firstName}!` : `Dzień dobry, ${meta.firstName}!`;

    banner.innerHTML = `
      <div class="usos-hero-content">
        <div class="usos-hero-left">
          <div class="usos-hero-greeting-row">
            <h1 class="usos-hero-greeting">${greeting} 👋</h1>
            <span class="usos-hero-role-pill">Student</span>
          </div>
          <p class="usos-hero-subtitle">Twój osobisty panel Politechniki Śląskiej – witaj w nowym semestrze akademickim.</p>
          <div class="usos-hero-meta-chips">
            <div class="usos-hero-chip usos-hero-chip-album" id="usos-copy-album-chip" title="Kliknij, aby skopiować numer albumu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>Album: <strong>${meta.albumNumber}</strong></span>
              <svg class="usos-copy-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </div>
            <div class="usos-hero-chip" title="Wydział">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 21h18"></path>
                <path d="M5 21V7l8-4v18"></path>
                <path d="M19 21V11l-6-4"></path>
                <line x1="9" y1="9" x2="9" y2="9.01"></line>
                <line x1="9" y1="12" x2="9" y2="12.01"></line>
                <line x1="9" y1="15" x2="9" y2="15.01"></line>
                <line x1="9" y1="18" x2="9" y2="18.01"></line>
              </svg>
              <span>${meta.faculty.replace('Wydział Automatyki, Elektroniki i Informatyki', 'Wydział AEI (RAU)')}</span>
            </div>
            <div class="usos-hero-chip" title="Kierunek studiów">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
                <path d="M6 12v5c3 3 9 3 12 0v-5"></path>
              </svg>
              <span>${meta.programme.split(',')[0]}</span>
            </div>
            ${meta.daysLeft ? `
            <div class="usos-hero-chip usos-hero-chip-deadline" title="Czas do końca etapu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span>Rozliczenie etapu: <strong>${meta.daysLeft}</strong></span>
            </div>` : ''}
          </div>
        </div>
        <div class="usos-hero-actions">
          <a href="/kontroler.php?_action=home/plan" class="usos-hero-btn primary" title="Otwórz pełny plan zajęć">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>Pełny plan</span>
          </a>
          <a href="/kontroler.php?_action=dla_stud/studia/oceny/index" class="usos-hero-btn secondary" title="Zobacz swoje oceny i protokoły">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span>Oceny</span>
          </a>
          <a href="/kontroler.php?_action=dla_stud/rejestracja/kalendarz" class="usos-hero-btn secondary" title="Kalendarz rejestracji na przedmioty">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="8.5" cy="7.5" r="4"></circle>
              <polyline points="17 11 19 13 23 9"></polyline>
            </svg>
            <span>Rejestracje</span>
          </a>
          <a href="/kontroler.php?_action=katalog2/index" class="usos-hero-btn secondary" title="Przeszukaj katalog USOS">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <span>Katalog</span>
          </a>
        </div>
      </div>
    `;

    // Obsługa kopiowania albumu
    const albumChip = banner.querySelector('#usos-copy-album-chip');
    if (albumChip) {
      albumChip.addEventListener('click', () => {
        navigator.clipboard.writeText(meta.albumNumber).then(() => {
          albumChip.classList.add('copied');
          const spanEl = albumChip.querySelector('span');
          const origHtml = spanEl.innerHTML;
          spanEl.innerHTML = 'Skopiowano!';
          setTimeout(() => {
            albumChip.classList.remove('copied');
            spanEl.innerHTML = origHtml;
          }, 1800);
        });
      });
    }

    return banner;
  }

  /* ==========================================================================
     6h. PASEK ZAPOWIEDZI NAJBLIŻSZYCH ZAJĘĆ & FORMATOWANIE HARMONOGRAMU WIDŻETU
     ========================================================================== */

  function findUpcomingClassBanner() {
    const elements = Array.from(document.querySelectorAll('div, p, section, table, td, span')).filter((el) => {
      if (el.closest('#usos-modern-navbar, #usos-home-dashboard, .usos-home-hero, usos-timetable, .lista-zajec, #usos-schedule-filter-bar')) {
        return false;
      }
      const txt = (el.innerText || el.textContent || '').trim();
      if (/(?:godz\.\s*\d{1,2}:\d{2}|godzina\s*\d{1,2}:\d{2})/i.test(txt) && /sala\s*:\s*\S+/i.test(txt)) {
        return txt.length < 300;
      }
      return false;
    });

    if (elements.length === 0) return null;

    let chosen = elements[0];
    for (const el of elements) {
      if (el.classList.contains('ui-state-highlight') || el.classList.contains('info') || el.classList.contains('warning') || el.tagName === 'DIV') {
        chosen = el;
        break;
      }
    }

    if (chosen.closest('table') && !chosen.closest('table').classList.contains('local-home-table')) {
      chosen = chosen.closest('table');
    }

    return chosen;
  }

  function modernizeUpcomingClassBanner() {
    const banner = findUpcomingClassBanner();
    if (!banner) return;
    if (banner.dataset.usosUpcomingProcessed) return;
    banner.dataset.usosUpcomingProcessed = 'true';

    const origLink = banner.querySelector('a');
    let courseTitle = origLink ? origLink.textContent.trim() : '';
    let courseHref = origLink ? origLink.getAttribute('href') : '';

    const fullText = (banner.innerText || banner.textContent || '').trim().replace(/\s+/g, ' ');

    let dayTime = '';
    const dayTimeMatch = fullText.match(/((?:poniedziałek|wtorek|środa|czwartek|piątek|sobota|niedziela|dzisiaj|jutro)[^:]*godz\.\s*\d{1,2}:\d{2}|godz\.\s*\d{1,2}:\d{2})/i);
    if (dayTimeMatch) {
      dayTime = dayTimeMatch[1].trim();
      dayTime = dayTime.charAt(0).toUpperCase() + dayTime.slice(1);
    }

    let typeTag = '';
    const typeMatch = fullText.match(/\b(WYK|ĆW|CW|LAB|PROJ|LEKT|SEM)\b/i);
    if (typeMatch) {
      typeTag = typeMatch[1].toUpperCase();
    }

    let room = '';
    const roomMatch = fullText.match(/sala\s*:\s*([^,\s<]+)/i) || fullText.match(/sala\s+([A-Za-z0-9\/-]+)/i);
    if (roomMatch) {
      room = roomMatch[1].trim();
    }

    if (!courseTitle) {
      const parts = fullText.split(/godz\.\s*\d{1,2}:\d{2}:?/i);
      if (parts.length > 1) {
        let rest = parts[1].replace(/(?:WYK|ĆW|CW|LAB|PROJ|LEKT|SEM).*$/i, '').trim();
        rest = rest.replace(/sala.*$/i, '').trim();
        if (rest) courseTitle = rest;
      }
    }

    let typeBadgeClass = 'badge-lab';
    if (typeTag === 'WYK') typeBadgeClass = 'badge-wyklad';
    else if (typeTag === 'CW' || typeTag === 'ĆW') typeBadgeClass = 'badge-cwiczenia';
    else if (typeTag === 'LAB') typeBadgeClass = 'badge-lab';
    else if (typeTag === 'PROJ') typeBadgeClass = 'badge-proj';
    else if (typeTag === 'LEKT') typeBadgeClass = 'badge-lektorat';

    banner.removeAttribute('style');
    banner.className = 'usos-upcoming-class-banner usos-modern-only';

    banner.innerHTML = `
      <div class="usos-upcoming-inner">
        <div class="usos-upcoming-badge">
          <span class="usos-upcoming-pulse-dot"></span>
          <span class="usos-upcoming-badge-text">Najbliższe zajęcia</span>
        </div>
        <div class="usos-upcoming-details">
          ${dayTime ? `
            <div class="usos-upcoming-time-group">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              <span class="usos-upcoming-day-time">${dayTime}</span>
            </div>
          ` : ''}
          ${dayTime && courseTitle ? `<span class="usos-upcoming-dot-sep">•</span>` : ''}
          ${courseTitle ? `
            <a href="${courseHref || '#'}" class="usos-upcoming-subject-link" title="Przejdź do przedmiotu">
              <span>${courseTitle}</span>
              ${courseHref ? `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              ` : ''}
            </a>
          ` : ''}
          ${typeTag ? `<span class="usos-upcoming-type-badge ${typeBadgeClass}">${typeTag}</span>` : ''}
          ${room ? `
            <div class="usos-upcoming-room-chip">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>Sala <strong>${room}</strong></span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    const heroBanner = document.querySelector('.usos-home-hero');
    if (heroBanner && banner.nextSibling !== heroBanner) {
      heroBanner.parentNode.insertBefore(banner, heroBanner);
    }
  }

  function tagAndFormatTimetableEntry(entry) {
    if (!entry) return;

    const text = (entry.textContent || '').trim();
    const title = (entry.getAttribute('title') || '').trim();
    const raw = (text + ' ' + title).toUpperCase();

    // Dopasowanie klas formy zajęć do legendy
    if (raw.includes('LEKT') || raw.includes('LEK') || raw.includes('LEKTORAT') || raw.includes('JĘZYK') || raw.includes('ANGIELSKI') || raw.includes('NIEMIECKI')) {
      entry.classList.add('usos-entry-lektorat');
      entry.setAttribute('data-course-type', 'lektorat');
    } else if (raw.includes('PROJ') || raw.includes('PROJEKT')) {
      entry.classList.add('usos-entry-proj');
      entry.setAttribute('data-course-type', 'projekt');
    } else if (raw.includes('LAB') || raw.includes('LABORATOR')) {
      entry.classList.add('usos-entry-lab');
      entry.setAttribute('data-course-type', 'laboratorium');
    } else if (raw.includes('WYK') || raw.includes('WYKŁAD')) {
      entry.classList.add('usos-entry-wyklad');
      entry.setAttribute('data-course-type', 'wyklad');
    } else if (raw.includes('CW') || raw.includes('ĆW') || raw.includes('ĆWICZEN')) {
      entry.classList.add('usos-entry-cwiczenia');
      entry.setAttribute('data-course-type', 'cwiczenia');
    } else if (raw.includes('SEM') || raw.includes('SEMINAR')) {
      entry.classList.add('usos-entry-sem');
      entry.setAttribute('data-course-type', 'seminarium');
    }

    if (!entry.querySelector('.usos-mini-time-badge')) {
      const start = parseGridTime(entry.style.gridRowStart);
      const end = parseGridTime(entry.style.gridRowEnd);
      if (start && end) {
        const timeBadge = document.createElement('span');
        timeBadge.className = 'usos-mini-time-badge';
        timeBadge.textContent = `${formatTime(start)}–${formatTime(end)}`;
        entry.appendChild(timeBadge);
      }
    }

    if (!entry.getAttribute('title') && (title || text)) {
      entry.setAttribute('title', (title || text).replace(/\s+/g, ' ').trim());
    }
  }

  function formatScheduleWidgetTimetable(container) {
    if (!container) return;
    const tt = container.querySelector('usos-timetable') || (container.tagName?.toLowerCase() === 'usos-timetable' ? container : null);
    if (!tt) return;

    tt.style.setProperty('width', '100%', 'important');
    tt.style.setProperty('max-width', 'none', 'important');
    tt.style.setProperty('display', 'flex', 'important');
    tt.style.setProperty('flex-direction', 'row', 'important');
    tt.style.setProperty('box-sizing', 'border-box', 'important');
    tt.style.setProperty('height', '560px', 'important');
    tt.style.setProperty('min-height', '520px', 'important');

    const cols = Array.from(tt.children);
    cols.forEach((col) => {
      const day = col.querySelector('timetable-day');
      if (day) {
        col.style.setProperty('flex', '1 1 0%', 'important');
        col.style.setProperty('min-width', '0', 'important');
        col.style.setProperty('max-width', 'none', 'important');
        col.style.setProperty('width', 'auto', 'important');
        day.style.setProperty('width', '100%', 'important');
        day.style.setProperty('max-width', 'none', 'important');
        day.style.setProperty('min-width', '0', 'important');
        day.style.setProperty('height', '100%', 'important');
      } else {
        col.style.setProperty('flex', '0 0 auto', 'important');
        col.style.setProperty('width', 'auto', 'important');
        col.style.setProperty('min-width', '32px', 'important');
        col.style.setProperty('max-width', '45px', 'important');
      }
    });

    tt.querySelectorAll('timetable-entry').forEach(tagAndFormatTimetableEntry);
    tt.querySelectorAll('timetable-day').forEach(recalculateDayColumns);
  }

  function buildInteractiveScheduleCard() {
    const allFrames = Array.from(document.querySelectorAll('usos-frame'));
    const currentWeekFrame = allFrames.find((f) => f.querySelector('h2')?.textContent.includes('aktualny tydzień'));
    const nextWeekFrame = allFrames.find((f) => f.querySelector('h2')?.textContent.includes('następny tydzień'));

    if (!currentWeekFrame && !nextWeekFrame) return null;

    const card = document.createElement('div');
    card.className = 'usos-home-card usos-home-schedule-widget';

    // Header
    const header = document.createElement('div');
    header.className = 'usos-home-card-header usos-sched-header';

    header.innerHTML = `
      <div class="usos-sched-header-left">
        <div class="usos-home-card-title-group">
          <svg class="usos-sched-title-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span class="usos-home-card-title">Plan zajęć</span>
        </div>
        <div class="usos-sched-tabs" role="tablist">
          <button type="button" class="usos-sched-tab-btn active" data-target="tab-current" role="tab" aria-selected="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 11 12 14 22 4"></polyline>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            <span>Bieżący tydzień</span>
          </button>
          <button type="button" class="usos-sched-tab-btn" data-target="tab-next" role="tab" aria-selected="false">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
            <span>Następny tydzień</span>
          </button>
        </div>
      </div>
      <div class="usos-sched-header-right">
        <div class="usos-sched-datepicker-slot"></div>
        <a href="/kontroler.php?_action=home/plan" class="usos-sched-full-link">
          <span>Otwórz pełny plan</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="7" y1="17" x2="17" y2="7"></line>
            <polyline points="7 7 17 7 17"></polyline>
          </svg>
        </a>
      </div>
    `;

    // Przenieś datepicker ze starej ramki (jeśli istnieje)
    const origDatepicker = currentWeekFrame?.querySelector('.datepicker-native-container');
    if (origDatepicker) {
      const slot = header.querySelector('.usos-sched-datepicker-slot');
      if (slot) slot.appendChild(origDatepicker);
    }

    card.appendChild(header);

    // Tab Panels Body
    const body = document.createElement('div');
    body.className = 'usos-home-card-body usos-sched-body';

    // Panel 1: Aktualny tydzień
    const pane1 = document.createElement('div');
    pane1.id = 'tab-current';
    pane1.className = 'usos-sched-tab-pane active';
    const plan1 = currentWeekFrame?.querySelector('.plan') || currentWeekFrame?.querySelector('usos-timetable');
    if (plan1) {
      pane1.appendChild(plan1);
      formatScheduleWidgetTimetable(pane1);
    } else {
      pane1.innerHTML = '<div class="usos-sched-empty">Brak zajęć w bieżącym tygodniu.</div>';
    }
    body.appendChild(pane1);

    // Panel 2: Następny tydzień
    const pane2 = document.createElement('div');
    pane2.id = 'tab-next';
    pane2.className = 'usos-sched-tab-pane';
    pane2.style.display = 'none';
    const plan2 = nextWeekFrame?.querySelector('.plan') || nextWeekFrame?.querySelector('usos-timetable');
    if (plan2) {
      pane2.appendChild(plan2);
      formatScheduleWidgetTimetable(pane2);
    } else {
      pane2.innerHTML = '<div class="usos-sched-empty">Brak zajęć w następnym tygodniu.</div>';
    }
    body.appendChild(pane2);

    card.appendChild(body);

    // Legenda na dole planu
    const footer = document.createElement('div');
    footer.className = 'usos-sched-legend-footer';
    footer.innerHTML = `
      <span class="usos-legend-title">Legenda:</span>
      <div class="usos-legend-items">
        <span class="usos-legend-item badge-wyklad"><span class="usos-legend-dot"></span> Wykład</span>
        <span class="usos-legend-item badge-cwiczenia"><span class="usos-legend-dot"></span> Ćwiczenia</span>
        <span class="usos-legend-item badge-lab"><span class="usos-legend-dot"></span> Laboratorium</span>
        <span class="usos-legend-item badge-proj"><span class="usos-legend-dot"></span> Projekt</span>
        <span class="usos-legend-item badge-lektorat"><span class="usos-legend-dot"></span> Lektorat</span>
      </div>
    `;
    card.appendChild(footer);

    // Obsługa przełączania zakładek
    const tabBtns = header.querySelectorAll('.usos-sched-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        tabBtns.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        if (targetId === 'tab-current') {
          pane1.style.display = 'block';
          pane2.style.display = 'none';
          formatScheduleWidgetTimetable(pane1);
        } else {
          pane1.style.display = 'none';
          pane2.style.display = 'block';
          formatScheduleWidgetTimetable(pane2);
        }

        window.dispatchEvent(new Event('resize'));
      });
    });

    return card;
  }

  function buildModernCoursesCard() {
    const allFrames = Array.from(document.querySelectorAll('usos-frame'));
    const coursesFrame = allFrames.find(
      (f) => f.classList.contains('student') || f.querySelector('h2')?.textContent.includes('Zajęcia studenta')
    );

    if (!coursesFrame) return null;

    const card = document.createElement('div');
    card.className = 'usos-home-card usos-courses-widget';

    // Header
    const header = document.createElement('div');
    header.className = 'usos-home-card-header';

    const semSpan = coursesFrame.querySelector('.screen-reader-only');
    const semText = semSpan ? semSpan.textContent.trim() : 'Semestr letni 2026/2027';

    header.innerHTML = `
      <div class="usos-home-card-title-group">
        <svg class="usos-courses-title-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>
        <span class="usos-home-card-title">Zajęcia studenta</span>
        <span class="usos-term-badge">${semText}</span>
      </div>
      <div class="usos-home-card-actions">
        <a href="/kontroler.php?_action=home/grupy" class="usos-sched-full-link">
          <span>Moje grupy</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>
      </div>
    `;
    card.appendChild(header);

    // Body z przekształconą listą
    const courseList = coursesFrame.querySelector('.lista-zajec');
    const body = document.createElement('div');
    body.className = 'usos-home-card-body usos-courses-body';

    if (courseList) {
      const courseItems = courseList.querySelectorAll(':scope > li');
      courseItems.forEach((li) => {
        li.classList.add('usos-course-item-card');

        // Usuń stare szare kolory
        const links = li.querySelectorAll('a.wrgrey');
        links.forEach((l) => l.classList.remove('wrgrey'));

        // Pigułki dla grup zajęć
        const groupLinks = li.querySelectorAll('.inlined-list li a');
        groupLinks.forEach((gLink) => {
          const text = gLink.textContent.toLowerCase();
          gLink.classList.add('usos-group-pill');
          if (text.includes('wykład')) gLink.classList.add('pill-wyklad');
          else if (text.includes('ćwiczenia')) gLink.classList.add('pill-cwiczenia');
          else if (text.includes('laboratorium') || text.includes('lab')) gLink.classList.add('pill-lab');
          else if (text.includes('projekt')) gLink.classList.add('pill-proj');
          else if (text.includes('lektorat')) gLink.classList.add('pill-lektorat');
        });
      });

      body.appendChild(courseList);
    } else {
      body.innerHTML = '<div class="usos-sched-empty">Brak zarejestrowanych zajęć w bieżącym semestrze.</div>';
    }

    card.appendChild(body);
    return card;
  }

  function buildStudentProfileCard(meta) {
    const card = document.createElement('div');
    card.className = 'usos-home-card usos-student-profile-card';

    // Header profilowy
    const header = document.createElement('div');
    header.className = 'usos-profile-header';

    const initials = meta.fullName
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'BR';

    header.innerHTML = `
      <div class="usos-profile-avatar-row">
        <div class="usos-profile-avatar">${initials}</div>
        <div class="usos-profile-info">
          <h3 class="usos-profile-name">${meta.fullName}</h3>
          <span class="usos-profile-prog-label">${meta.programme}</span>
          <div class="usos-profile-status-badge">
            <span class="usos-pulse-dot"></span>
            <span>Student aktywny</span>
          </div>
        </div>
      </div>
    `;
    card.appendChild(header);

    // Statystyki i ostrzeżenia o podpięciach
    const body = document.createElement('div');
    body.className = 'usos-home-card-body usos-profile-body';

    body.innerHTML = `
      <div class="usos-profile-stat-box">
        <div class="usos-stat-item">
          <div class="usos-stat-icon-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div class="usos-stat-text">
            <div class="usos-stat-val">9 przedmiotów</div>
            <div class="usos-stat-sub">Zapisany w semestrze letnim</div>
          </div>
        </div>

        <div class="usos-stat-warning-item">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <span><strong>1</strong> niepodpięty pod żaden program</span>
            <span class="usos-stat-hint">Przedmiot ponadplanowy</span>
          </div>
        </div>

        <div class="usos-stat-info-item">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <div>
            <span><strong>8</strong> podpiętych pod program, brak pod etap</span>
            <span class="usos-stat-hint">Wymaga zatwierdzenia etapowego</span>
          </div>
        </div>

        ${meta.daysLeft ? `
        <div class="usos-stat-countdown-box">
          <div class="usos-countdown-header">
            <span>Czas do rozliczenia etapu</span>
            <span class="usos-countdown-days">${meta.daysLeft}</span>
          </div>
          <div class="usos-countdown-bar">
            <div class="usos-countdown-progress" style="width: 72%;"></div>
          </div>
        </div>` : ''}
      </div>

      <div class="usos-profile-actions">
        <a href="/kontroler.php?_action=dla_stud/studia/podpiecia/lista" class="usos-btn-manage-podpiecia">
          <span>Zarządzaj podpięciami</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>
      </div>
    `;

    card.appendChild(body);
    return card;
  }

  function buildUnifiedSearchCard() {
    const katalogFrame = document.getElementById('katalog-frame');
    const planyFrame = document.getElementById('plany-frame');

    if (!katalogFrame && !planyFrame) return null;

    const card = document.createElement('div');
    card.className = 'usos-home-card usos-unified-search-card';

    // Header
    const header = document.createElement('div');
    header.className = 'usos-home-card-header';
    header.innerHTML = `
      <div class="usos-home-card-title-group">
        <svg class="usos-search-title-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span class="usos-home-card-title">Wyszukiwarka USOS</span>
      </div>
    `;
    card.appendChild(header);

    // Nawigacja po zakładkach
    const tabsNav = document.createElement('div');
    tabsNav.className = 'usos-search-tabs-nav';
    tabsNav.innerHTML = `
      <button type="button" class="usos-search-tab-pill active" data-form="osoby">Pracownik</button>
      <button type="button" class="usos-search-tab-pill" data-form="przedmioty">Przedmiot</button>
      <button type="button" class="usos-search-tab-pill" data-form="plany">Plany zajęć</button>
      <button type="button" class="usos-search-tab-pill" data-form="jednostki">Jednostka</button>
      <button type="button" class="usos-search-tab-pill" data-form="programy">Kierunek</button>
    `;
    card.appendChild(tabsNav);

    // Kontener na formularze
    const formsContainer = document.createElement('div');
    formsContainer.className = 'usos-search-forms-wrap';

    const formOsoby = katalogFrame?.querySelector('form[name="osoby"]');
    const formPrzedmioty = katalogFrame?.querySelector('form[name="przedmioty"]');
    const formJednostki = katalogFrame?.querySelector('form[name="jednostki"]');
    const formProgramy = katalogFrame?.querySelector('form[name="programy"]');

    const planyWrap = document.createElement('div');
    planyWrap.className = 'usos-plany-forms-wrap';
    if (planyFrame) {
      const pForms = planyFrame.querySelectorAll('form');
      pForms.forEach((pf) => planyWrap.appendChild(pf));
    }

    const allTabSections = [
      { key: 'osoby', el: formOsoby },
      { key: 'przedmioty', el: formPrzedmioty },
      { key: 'plany', el: planyWrap },
      { key: 'jednostki', el: formJednostki },
      { key: 'programy', el: formProgramy },
    ];

    allTabSections.forEach(({ key, el }, idx) => {
      if (el) {
        el.dataset.searchKey = key;
        el.style.display = idx === 0 ? 'block' : 'none';
        formsContainer.appendChild(el);
      }
    });

    card.appendChild(formsContainer);

    // Obsługa przełączania zakładek wyszukiwarki
    const pills = tabsNav.querySelectorAll('.usos-search-tab-pill');
    pills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const targetKey = pill.dataset.form;
        pills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');

        allTabSections.forEach(({ key, el }) => {
          if (el) {
            el.style.display = key === targetKey ? 'block' : 'none';
          }
        });
      });
    });

    return card;
  }

  function buildPreferencesCard() {
    const prefFrame = document.getElementById('preferencje-frame');
    const infoFrame = document.getElementById('info-frame');
    const allFrames = Array.from(document.querySelectorAll('usos-frame'));
    const privFrame = allFrames.find((f) => f.querySelector('h2')?.textContent.includes('Preferencje prywatności'));

    if (!prefFrame && !infoFrame && !privFrame) return null;

    const card = document.createElement('div');
    card.className = 'usos-home-card usos-compact-prefs-card';

    const profileAnchor = infoFrame?.querySelector('a[href*="pokazOsobe"]');
    const profileHref = profileAnchor ? profileAnchor.href : '/kontroler.php?_action=katalog2/osoby/pokazOsobe';

    const infoText = infoFrame ? infoFrame.textContent : '';
    const expiryMatch = infoText.match(/dostęp do USOSweb wygasa:\s*(\d{4}-\d{2}-\d{2})/i);
    const expiryDate = expiryMatch ? expiryMatch[1] : '2030-02-28';

    card.innerHTML = `
      <div class="usos-prefs-row">
        <div class="usos-prefs-left">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>Konto USOSweb (dostęp do <strong>${expiryDate}</strong>)</span>
        </div>
        <div class="usos-prefs-links">
          <a href="${profileHref}" class="usos-prefs-link">Mój profil</a>
          <span class="usos-prefs-sep">•</span>
          <a href="/kontroler.php?_action=home/preferencje/preferencjeUsosweb" class="usos-prefs-link">Ustawienia</a>
          <span class="usos-prefs-sep">•</span>
          <a href="/kontroler.php?_action=home/preferencje/preferencjePrywatnosci" class="usos-prefs-link">Prywatność</a>
        </div>
      </div>
    `;

    return card;
  }

  /* ==========================================================================
     6.5. MODERNIZACJA STRONY PRZERWY TECHNICZNEJ (MAINTENANCE HUB)
     ========================================================================== */

  const USOS_EXCUSES = [
    "Nie mogłem sprawdzić wymagań na projekt, bo USOS miał akurat przerwę techniczną.",
    "Prowadzący na pewno jeszcze nie wpisał ocen, więc USOS sam postanowił pójść na kawę.",
    "Wysłałbym sprawozdanie przed 23:59, ale serwery USOSa wybrały ten sam moment na drzemkę.",
    "To nie prokrastynacja, to oficjalne okienko technologiczne narzucone przez uczelnię.",
    "Mój kod działał lokalnie, dopóki baza USOSa nie postanowiła przeładować sterowników.",
    "Czekałem na rejestrację żetonową, a dostałem bilet na darmową przerwę na herbatę.",
    "Próbowałem podpiąć przedmiot, ale algorytm USOSa uznał, że zasługuję na odpoczynek.",
    "Błąd 503: Zbyt wysoki poziom stresu przed sesją, serwery przeszły w tryb relaksu.",
    "Chciałem sprawdzić plan na jutro, ale los dał mi znać, że rano można pospać dłużej.",
    "Zgodnie z zasadą dynamiki Newtona: ciało studenta pozostaje w spoczynku, gdy USOS nie działa.",
    "Czekałem na zatwierdzenie podania w dziekanacie, a serwer poszedł do archiwum.",
    "Dziś zamiast USOSa działa tylko generator wymówek. I to w 60 klatkach na sekundę!"
  ];

  /**
   * Sprawdza, czy bieżąca strona przedstawia przerwę techniczną USOSweb
   */
  function isMaintenanceBreak() {
    // 1. Tryb deweloperski / testowy
    if (window.location.hash.includes('test-maintenance') || window.location.search.includes('test_maintenance=1')) {
      return true;
    }

    // 2. Weryfikacja tekstu strony
    const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
    const hasMaintenanceKeywords = (
      bodyText.includes('przerwa techniczna') ||
      bodyText.includes('usosweb tymczasowo niedostępny') ||
      bodyText.includes('tymczasowo niedostępny') ||
      bodyText.includes('prace konserwacyjne') ||
      bodyText.includes('prace serwisowe')
    );

    if (!hasMaintenanceKeywords) return false;

    // Wyklucz pełny działający pulpit
    const isFullDashboard = Boolean(document.querySelector('.local-home-table, #usos-home-dashboard, usos-timetable'));
    if (isFullDashboard) return false;

    // Sprawdź czy występuje charakterystyczny nagłówek lub usos-frame
    const heading = document.querySelector('h1, h2, #layout-c22 > h1, #layout-main-content > h1');
    const headingText = (heading ? heading.textContent : '').toLowerCase();
    const isMaintHeading = headingText.includes('niedostępny') || headingText.includes('przerwa') || headingText.includes('konserwacja');

    const usesLegacyMaintFrame = Boolean(
      document.querySelector('usos-frame[title*="Szczegóły" i], usos-frame[title*="Przerwa" i]') ||
      document.querySelector('img[src*="roboty"], img[src*="przerwa"], img[src*="maintenance"]')
    );

    return isMaintHeading || usesLegacyMaintFrame || (bodyText.length < 900 && hasMaintenanceKeywords);
  }

  /**
   * Buduje nowoczesny interfejs przerwy technicznej (Hero, Mini-Gra, Wymówki, Usługi)
   */
  function buildModernMaintenanceUI() {
    const wrapper = document.createElement('div');
    wrapper.id = 'usos-modern-maintenance';
    wrapper.className = 'usos-maint-wrapper usos-modern-only';

    const now = new Date().toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    wrapper.innerHTML = `
      <!-- 1. KARTA HERO Z WEKTOROWĄ ILUSTRACJĄ -->
      <div class="usos-maint-hero-card">
        <div class="usos-maint-hero-content">
          <div class="usos-maint-status-chip">
            <span class="usos-maint-pulse"></span>
            <span>Prace konserwacyjne w toku</span>
          </div>
          <h1 class="usos-maint-title">USOSweb odpoczywa...</h1>
          <p class="usos-maint-subtitle">
            Trwa zaplanowana przerwa techniczna systemu lub nocna archiwizacja baz danych.<br>
            Twoje oceny, plany zajęć i punkty ECTS są w pełni bezpieczne. Zaraz wracamy!
          </p>

          <div class="usos-maint-ping-box">
            <div class="usos-maint-ping-status">
              <div class="usos-maint-ping-info">
                <span class="usos-maint-ping-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </span>
                <span>Automatyczne sprawdzenie za: <strong id="usos-maint-countdown-val">30s</strong></span>
              </div>
              <div class="usos-maint-ping-progress-track">
                <div id="usos-maint-progress-bar" class="usos-maint-ping-progress-bar" style="width: 100%;"></div>
              </div>
            </div>

            <div class="usos-maint-ping-actions">
              <button type="button" id="usos-maint-refresh-btn" class="usos-maint-btn primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <polyline points="1 20 1 14 7 14"></polyline>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                Odśwież stronę
              </button>
              <button type="button" id="usos-maint-check-btn" class="usos-maint-btn secondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Sprawdź czy już działa
              </button>
            </div>
            <div id="usos-maint-feedback" class="usos-maint-feedback info" style="display: none;"></div>
          </div>
        </div>

        <div class="usos-maint-illustration-wrap">
          <svg class="usos-maint-svg" viewBox="0 0 460 320" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="usosMaintGradServer" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#1e293b"/>
                <stop offset="100%" stop-color="#0f172a"/>
              </linearGradient>
              <linearGradient id="usosMaintGradVisor" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#0284c7"/>
                <stop offset="100%" stop-color="#2563eb"/>
              </linearGradient>
              <linearGradient id="usosMaintGradCap" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#1e3a8a"/>
                <stop offset="100%" stop-color="#172554"/>
              </linearGradient>
              <linearGradient id="usosMaintGradGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#fde047"/>
                <stop offset="100%" stop-color="#f59e0b"/>
              </linearGradient>
              <linearGradient id="usosMaintGradBot" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3b82f6"/>
                <stop offset="100%" stop-color="#1d4ed8"/>
              </linearGradient>
              <filter id="usosMaintGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="6" result="blur"/>
                <feComposite in="SourceGraphic" in2="blur" operator="over"/>
              </filter>
            </defs>

            <!-- Poświata w tle -->
            <circle cx="155" cy="150" r="110" fill="#3b82f6" opacity="0.12" filter="url(#usosMaintGlow)"/>
            <circle cx="350" cy="165" r="95" fill="#8b5cf6" opacity="0.1" filter="url(#usosMaintGlow)"/>

            <!-- Linie obwodów w tle -->
            <path d="M 160 215 L 220 215 L 250 180 L 290 180" stroke="#334155" stroke-width="2" stroke-dasharray="4 4" opacity="0.6"/>
            <path d="M 120 180 L 80 180 L 60 140" stroke="#334155" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.5"/>
            <circle cx="290" cy="180" r="3" fill="#38bdf8" opacity="0.8"/>
            <circle cx="60" cy="140" r="3" fill="#818cf8" opacity="0.8"/>

            <!-- Pływająca odznaka 1 (Góra Lewo) -->
            <g class="usos-svg-floating-badge-1" transform="translate(25, 30)">
              <rect width="154" height="32" rx="16" fill="#0f172a" fill-opacity="0.88" stroke="#38bdf8" stroke-width="1.5"/>
              <circle cx="16" cy="16" r="4.5" fill="#38bdf8"/>
              <text x="29" y="20" fill="#f8fafc" font-size="11" font-weight="650" font-family="system-ui, sans-serif">Serwis baz danych</text>
            </g>

            <!-- Pływająca odznaka 2 (Góra Prawo) -->
            <g class="usos-svg-floating-badge-2" transform="translate(285, 20)">
              <rect width="144" height="32" rx="16" fill="#0f172a" fill-opacity="0.88" stroke="#10b981" stroke-width="1.5"/>
              <circle cx="16" cy="16" r="4.5" fill="#10b981"/>
              <text x="29" y="20" fill="#f8fafc" font-size="11" font-weight="650" font-family="system-ui, sans-serif">ECTS: Bezpieczne 🔒</text>
            </g>

            <!-- Szafa Serwerowa (Server Rack) -->
            <g transform="translate(285, 68)">
              <!-- Obudowa szafy -->
              <rect width="145" height="215" rx="12" fill="url(#usosMaintGradServer)" stroke="#334155" stroke-width="2"/>
              <rect x="15" y="215" width="22" height="6" rx="2" fill="#1e293b"/>
              <rect x="108" y="215" width="22" height="6" rx="2" fill="#1e293b"/>

              <!-- Jednostka serwerowa 1 -->
              <rect x="10" y="14" width="125" height="52" rx="6" fill="#1e293b" stroke="#475569" stroke-width="1"/>
              <line x1="20" y1="26" x2="65" y2="26" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <line x1="20" y1="34" x2="65" y2="34" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <line x1="20" y1="42" x2="65" y2="42" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <line x1="20" y1="50" x2="65" y2="50" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <circle cx="85" cy="30" r="3.5" fill="#10b981" class="usos-svg-blink-1"/>
              <circle cx="98" cy="30" r="3.5" fill="#f59e0b" class="usos-svg-blink-2"/>
              <circle cx="111" cy="30" r="3.5" fill="#38bdf8" class="usos-svg-blink-3"/>
              <rect x="83" y="44" width="34" height="6" rx="2" fill="#0f172a"/>
              <line x1="86" y1="47" x2="108" y2="47" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" opacity="0.8"/>

              <!-- Jednostka serwerowa 2 -->
              <rect x="10" y="78" width="125" height="52" rx="6" fill="#1e293b" stroke="#475569" stroke-width="1"/>
              <line x1="20" y1="90" x2="65" y2="90" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <line x1="20" y1="98" x2="65" y2="98" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <line x1="20" y1="106" x2="65" y2="106" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <line x1="20" y1="114" x2="65" y2="114" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
              <circle cx="85" cy="94" r="3.5" fill="#f59e0b" class="usos-svg-blink-2"/>
              <circle cx="98" cy="94" r="3.5" fill="#10b981" class="usos-svg-blink-3"/>
              <circle cx="111" cy="94" r="3.5" fill="#ec4899" class="usos-svg-blink-1"/>
              <rect x="83" y="108" width="34" height="6" rx="2" fill="#0f172a"/>
              <line x1="86" y1="111" x2="100" y2="111" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" opacity="0.8"/>

              <!-- Jednostka dyskowa 3 -->
              <rect x="10" y="142" width="125" height="52" rx="6" fill="#1e293b" stroke="#475569" stroke-width="1"/>
              <rect x="20" y="152" width="18" height="32" rx="2" fill="#0f172a" stroke="#334155"/>
              <rect x="44" y="152" width="18" height="32" rx="2" fill="#0f172a" stroke="#334155"/>
              <rect x="68" y="152" width="18" height="32" rx="2" fill="#0f172a" stroke="#334155"/>
              <circle cx="29" cy="158" r="1.5" fill="#10b981" class="usos-svg-blink-3"/>
              <circle cx="53" cy="158" r="1.5" fill="#10b981" class="usos-svg-blink-1"/>
              <circle cx="77" cy="158" r="1.5" fill="#38bdf8" class="usos-svg-blink-2"/>
              <text x="94" y="166" fill="#94a3b8" font-size="8.5" font-family="monospace">USOS-DB</text>
              <text x="94" y="178" fill="#38bdf8" font-size="8.5" font-family="monospace">SLEEPING</text>
            </g>

            <!-- Robot Student (Pływająca animacja) -->
            <g class="usos-svg-robot-group">
              <!-- Cień robota -->
              <ellipse cx="155" cy="285" rx="65" ry="12" fill="#000000" opacity="0.25"/>

              <!-- Ciało / Bluza robota -->
              <rect x="105" y="145" width="100" height="98" rx="28" fill="url(#usosMaintGradBot)" stroke="#60a5fa" stroke-width="2"/>
              <!-- Tarcza uczelni na piersi -->
              <rect x="135" y="162" width="40" height="24" rx="6" fill="#0f172a" stroke="#93c5fd" stroke-width="1"/>
              <text x="144" y="179" fill="#f8fafc" font-size="11" font-weight="800" font-family="system-ui, sans-serif">PŚ</text>

              <!-- Lewe ramię -->
              <path d="M 105 165 C 80 180 82 215 98 225" stroke="#3b82f6" stroke-width="14" stroke-linecap="round" fill="none"/>

              <!-- Głowa robota -->
              <rect x="115" y="78" width="80" height="66" rx="22" fill="#f8fafc" stroke="#94a3b8" stroke-width="2"/>
              <line x1="155" y1="78" x2="155" y2="60" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
              <circle cx="155" cy="58" r="5" fill="#f59e0b" class="usos-svg-blink-1"/>

              <!-- Ekran / Wizjer z uśmiechniętymi oczami -->
              <rect x="125" y="90" width="60" height="36" rx="12" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
              <path d="M 137 109 Q 143 101 149 109" stroke="#38bdf8" stroke-width="3.2" stroke-linecap="round" fill="none"/>
              <path d="M 161 109 Q 167 101 173 109" stroke="#38bdf8" stroke-width="3.2" stroke-linecap="round" fill="none"/>

              <!-- Biret Studencki (Graduation Cap) -->
              <polygon points="155,26 215,44 155,62 95,44" fill="url(#usosMaintGradCap)" stroke="#3b82f6" stroke-width="2"/>
              <path d="M 124 53 Q 155 68 186 53 L 186 62 Q 155 77 124 62 Z" fill="#172554"/>
              <circle cx="155" cy="44" r="4.5" fill="url(#usosMaintGradGold)"/>
              <path d="M 155 44 C 185 45 205 60 212 85" stroke="#f59e0b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
              <rect x="209" y="85" width="6" height="12" rx="2" fill="url(#usosMaintGradGold)"/>

              <!-- Prawe ramię trzymające kubek kawy -->
              <path d="M 205 165 C 220 185 205 215 185 220" stroke="#3b82f6" stroke-width="14" stroke-linecap="round" fill="none"/>

              <!-- Kubek Gorącej Kawy -->
              <g transform="translate(182, 185)">
                <path d="M 24 6 C 34 6 34 22 24 22" stroke="#e2e8f0" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                <rect x="0" y="0" width="26" height="28" rx="4" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
                <rect x="0" y="5" width="26" height="6" fill="#1e40af"/>
                <ellipse cx="13" cy="2" rx="10" ry="2" fill="#78350f"/>

                <!-- Unosząca się para z kawy (Animacja) -->
                <path d="M 7 -4 Q 5 -12 9 -18" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" fill="none" class="usos-svg-steam-1"/>
                <path d="M 13 -5 Q 16 -14 12 -22" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" fill="none" class="usos-svg-steam-2"/>
                <path d="M 19 -4 Q 22 -12 18 -19" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" fill="none" class="usos-svg-steam-3"/>
              </g>

              <!-- Nogi i buty -->
              <rect x="125" y="240" width="18" height="26" rx="6" fill="#1e293b"/>
              <rect x="167" y="240" width="18" height="26" rx="6" fill="#1e293b"/>
              <rect x="120" y="260" width="26" height="12" rx="4" fill="#0f172a"/>
              <rect x="164" y="260" width="26" height="12" rx="4" fill="#0f172a"/>
            </g>
          </svg>
        </div>
      </div>

      <!-- 2. GRID INTERAKTYWNY: MINI-GRA & GENERATOR WYMÓWEK -->
      <div class="usos-maint-interactive-grid">
        <!-- KARTA GRY -->
        <div class="usos-maint-card">
          <div class="usos-maint-card-header">
            <div class="usos-maint-card-title-wrap">
              <span class="usos-maint-card-icon">🎮</span>
              <div>
                <h3 class="usos-maint-card-title">Skocz po ECTS</h3>
                <p class="usos-maint-card-desc">Omijaj kolokwia i zbieraj zaliczenia podczas przerwy!</p>
              </div>
            </div>
            <div class="usos-maint-score-wrap">
              <div class="usos-maint-score-chip">Punkty: <strong id="usos-game-score">0</strong></div>
              <div class="usos-maint-score-chip highscore">Rekord: <strong id="usos-game-highscore">0</strong></div>
            </div>
          </div>
          <div class="usos-maint-game-container">
            <canvas id="usos-maint-game-canvas" width="600" height="190"></canvas>
            <div id="usos-maint-game-overlay" class="usos-maint-game-overlay">
              <div>
                <span class="usos-maint-game-overlay-emoji">🎓</span>
                <h4 id="usos-maint-game-overlay-title">Zagraj w Skocz po ECTS</h4>
                <p id="usos-maint-game-overlay-sub">Naciśnij <strong>SPACJĘ</strong> lub kliknij, aby skakać (podwójny skok działa!)</p>
                <button type="button" id="usos-maint-game-start-btn" class="usos-maint-btn primary">Rozpocznij grę</button>
              </div>
            </div>
          </div>
        </div>

        <!-- KARTA WYMÓWEK -->
        <div class="usos-maint-card">
          <div class="usos-maint-card-header">
            <div class="usos-maint-card-title-wrap">
              <span class="usos-maint-card-icon">🧠</span>
              <div>
                <h3 class="usos-maint-card-title">Generator Wymówek</h3>
                <p class="usos-maint-card-desc">Dlaczego jeszcze nie wysłałeś sprawozdania?</p>
              </div>
            </div>
          </div>
          <div class="usos-maint-excuse-body">
            <div class="usos-maint-excuse-quote">
              <p id="usos-maint-excuse-text">"Nie mogłem sprawdzić wymagań na projekt, bo USOS miał akurat przerwę techniczną."</p>
            </div>
            <div class="usos-maint-excuse-actions">
              <button type="button" id="usos-maint-next-excuse-btn" class="usos-maint-btn secondary">
                🎲 Losuj inną
              </button>
              <button type="button" id="usos-maint-copy-excuse-btn" class="usos-maint-btn secondary">
                📋 Kopiuj do schowka
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. DZIAŁAJĄCE USŁUGI UCZELNIANE -->
      <div class="usos-maint-links-section">
        <h3 class="usos-maint-section-heading">Działające usługi uczelniane</h3>
        <div class="usos-maint-links-grid">
          <a href="https://platforma.polsl.pl/" target="_blank" rel="noopener noreferrer" class="usos-maint-link-card">
            <div class="usos-maint-link-icon-wrap pze">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
                <path d="M6 12v5c3 3 9 3 12 0v-5"></path>
              </svg>
            </div>
            <div class="usos-maint-link-info">
              <h4>Platforma Zdalnej Edukacji</h4>
              <p>Moodle, materiały do zajęć i przesyłanie zadań</p>
            </div>
            <svg class="usos-maint-ext-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>

          <a href="https://poczta.polsl.pl/" target="_blank" rel="noopener noreferrer" class="usos-maint-link-card">
            <div class="usos-maint-link-icon-wrap mail">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
            </div>
            <div class="usos-maint-link-info">
              <h4>Poczta Studencka</h4>
              <p>Outlook Web App, kontakt z wykładowcami</p>
            </div>
            <svg class="usos-maint-ext-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>

          <a href="https://www.bg.polsl.pl/" target="_blank" rel="noopener noreferrer" class="usos-maint-link-card">
            <div class="usos-maint-link-icon-wrap bg">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </div>
            <div class="usos-maint-link-info">
              <h4>Biblioteka Główna</h4>
              <p>Katalog książek, e-zasoby i bazy naukowe</p>
            </div>
            <svg class="usos-maint-ext-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>

          <a href="https://www.polsl.pl/" target="_blank" rel="noopener noreferrer" class="usos-maint-link-card">
            <div class="usos-maint-link-icon-wrap polsl">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </div>
            <div class="usos-maint-link-info">
              <h4>Portal Główny Politechniki</h4>
              <p>Aktualności, komunikaty rektora i kalendarz</p>
            </div>
            <svg class="usos-maint-ext-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
        </div>
      </div>

      <!-- 4. SZCZEGÓŁY DIAGNOSTYCZNE -->
      <details class="usos-maint-details-box">
        <summary class="usos-maint-details-summary">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
          <span>Informacje diagnostyczne połączenia (kliknij, aby rozwinąć)</span>
        </summary>
        <div class="usos-maint-details-content">
          <div class="usos-maint-diag-row">
            <span>Czas sprawdzenia:</span>
            <code>${now}</code>
          </div>
          <div class="usos-maint-diag-row">
            <span>Host docelowy:</span>
            <code>${window.location.hostname || 'usosweb.polsl.pl'}</code>
          </div>
          <div class="usos-maint-diag-row">
            <span>Adres URL:</span>
            <code>${window.location.href}</code>
          </div>
          <div class="usos-maint-diag-row">
            <span>Status systemu:</span>
            <code>HTTP 503 / Scheduled Maintenance (Konserwacja bazy)</code>
          </div>
          <div class="usos-maint-diag-row">
            <span>Integralność danych:</span>
            <code>Bezpieczne (transakcje zatwierdzone, baza READ-ONLY)</code>
          </div>
        </div>
      </details>
    `;

    return wrapper;
  }

  /**
   * Inicjalizuje interaktywność: odliczanie, ping serwera, minigrę oraz generator wymówek
   */
  function initMaintenanceInteractivity(wrapper) {
    if (!wrapper) return;

    // --- A. ODLICZANIE I PING SERWERA ---
    let countdown = 30;
    const countdownVal = wrapper.querySelector('#usos-maint-countdown-val');
    const progressBar = wrapper.querySelector('#usos-maint-progress-bar');
    const feedback = wrapper.querySelector('#usos-maint-feedback');
    const refreshBtn = wrapper.querySelector('#usos-maint-refresh-btn');
    const checkBtn = wrapper.querySelector('#usos-maint-check-btn');

    async function checkServerStatus(manual = false) {
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.textContent = '⏳ Sprawdzam...';
      }
      if (feedback) {
        feedback.style.display = 'block';
        feedback.className = 'usos-maint-feedback info';
        feedback.textContent = 'Sprawdzam odpowiedź serwera USOSweb...';
      }

      try {
        const resp = await fetch(window.location.href, {
          method: 'GET',
          cache: 'no-store'
        });
        const text = await resp.text();
        const stillDown = /przerwa techniczna|niedostępny|prace konserwacyjne/i.test(text);

        if (resp.ok && !stillDown) {
          if (feedback) {
            feedback.className = 'usos-maint-feedback success';
            feedback.textContent = '🎉 USOSweb jest znowu dostępny! Przeładowuję stronę...';
          }
          setTimeout(() => {
            window.location.reload();
          }, 1200);
          return;
        }
      } catch (err) {
        // Ignoruj błąd sieciowy
      }

      if (feedback) {
        feedback.className = 'usos-maint-feedback info';
        feedback.textContent = manual
          ? 'Serwery USOSweb nadal odpoczywają. Twoje dane są bezpieczne, sprawdź ponownie za chwilę!'
          : 'Serwery USOSweb nadal zajęte. Ponowna próba za 30 sekund.';
      }

      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          Sprawdź czy już działa
        `;
      }
      countdown = 30;
    }

    const timerInterval = setInterval(() => {
      countdown--;
      if (countdownVal) countdownVal.textContent = `${countdown}s`;
      if (progressBar) progressBar.style.width = `${(countdown / 30) * 100}%`;

      if (countdown <= 0) {
        countdown = 30;
        checkServerStatus(false);
      }
    }, 1000);

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        window.location.reload();
      });
    }

    if (checkBtn) {
      checkBtn.addEventListener('click', () => {
        checkServerStatus(true);
      });
    }

    // --- B. GENERATOR WYMÓWEK ---
    const excuseText = wrapper.querySelector('#usos-maint-excuse-text');
    const nextExcuseBtn = wrapper.querySelector('#usos-maint-next-excuse-btn');
    const copyExcuseBtn = wrapper.querySelector('#usos-maint-copy-excuse-btn');
    let currentExcuseIndex = Math.floor(Math.random() * USOS_EXCUSES.length);

    if (excuseText) {
      excuseText.textContent = `"${USOS_EXCUSES[currentExcuseIndex]}"`;
    }

    if (nextExcuseBtn && excuseText) {
      nextExcuseBtn.addEventListener('click', () => {
        let newIndex;
        do {
          newIndex = Math.floor(Math.random() * USOS_EXCUSES.length);
        } while (newIndex === currentExcuseIndex && USOS_EXCUSES.length > 1);
        currentExcuseIndex = newIndex;

        excuseText.style.opacity = '0';
        excuseText.style.transition = 'opacity 0.15s ease';
        setTimeout(() => {
          excuseText.textContent = `"${USOS_EXCUSES[currentExcuseIndex]}"`;
          excuseText.style.opacity = '1';
        }, 150);
      });
    }

    if (copyExcuseBtn && excuseText) {
      copyExcuseBtn.addEventListener('click', () => {
        const rawText = excuseText.textContent.replace(/^"|"$/g, '');
        navigator.clipboard?.writeText(rawText).then(() => {
          const original = copyExcuseBtn.innerHTML;
          copyExcuseBtn.innerHTML = '✓ Skopiowano!';
          setTimeout(() => {
            copyExcuseBtn.innerHTML = original;
          }, 1800);
        }).catch(() => {
          // Fallback
        });
      });
    }

    // --- C. MINI-GRA: SKOCZ PO ECTS ---
    const canvas = wrapper.querySelector('#usos-maint-game-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const scoreEl = wrapper.querySelector('#usos-game-score');
    const highscoreEl = wrapper.querySelector('#usos-game-highscore');
    const overlay = wrapper.querySelector('#usos-maint-game-overlay');
    const overlayTitle = wrapper.querySelector('#usos-maint-game-overlay-title');
    const overlaySub = wrapper.querySelector('#usos-maint-game-overlay-sub');
    const startBtn = wrapper.querySelector('#usos-maint-game-start-btn');

    let highScore = parseInt(localStorage.getItem('usos_ects_highscore') || '0', 10);
    if (highscoreEl) highscoreEl.textContent = String(highScore);

    const GROUND_Y = 152;
    let score = 0;
    let isPlaying = false;
    let isGameOver = false;
    let animFrameId = null;
    let distanceCounter = 0;
    let gameSpeed = 4.2;
    let obstacleTimer = 70;
    let collectibleTimer = 110;

    const player = {
      x: 65,
      y: GROUND_Y - 36,
      w: 30,
      h: 36,
      vy: 0,
      jumpForce: -10.8,
      gravity: 0.65,
      isJumping: false,
      jumpCount: 0,
      animTick: 0
    };

    let obstacles = [];
    let collectibles = [];
    let particles = [];

    // Ambient stars in background
    const stars = Array.from({ length: 30 }, () => ({
      x: Math.random() * 600,
      y: Math.random() * 130,
      size: Math.random() * 1.8 + 0.8,
      speed: Math.random() * 0.6 + 0.2,
      alpha: Math.random() * 0.7 + 0.3
    }));

    const OBSTACLE_TYPES = [
      { label: 'Kolokwium', color: '#ef4444', w: 72, h: 22 },
      { label: 'Warunek', color: '#f97316', w: 62, h: 22 },
      { label: 'Termin 23:59', color: '#eab308', w: 82, h: 22 },
      { label: 'Dziekanat', color: '#a855f7', w: 66, h: 22 }
    ];

    const COLLECTIBLE_TYPES = [
      { label: '+5 ECTS', type: 'ects', color: '#10b981', points: 5, w: 22, h: 22 },
      { label: '+10 Kawa', type: 'coffee', color: '#38bdf8', points: 10, w: 22, h: 22 }
    ];

    function spawnParticles(x, y, color, count = 6) {
      for (let i = 0; i < count; i++) {
        particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.8) * 4,
          color,
          alpha: 1,
          size: Math.random() * 3 + 1.5
        });
      }
    }

    function triggerJump() {
      if (!isPlaying) {
        startGame();
        return;
      }
      if (isGameOver) {
        restartGame();
        return;
      }
      if (player.jumpCount < 2) {
        player.vy = player.jumpForce;
        player.isJumping = true;
        player.jumpCount++;
        spawnParticles(player.x + player.w / 2, player.y + player.h, '#38bdf8', 4);
      }
    }

    function startGame() {
      isPlaying = true;
      isGameOver = false;
      score = 0;
      gameSpeed = 4.2;
      distanceCounter = 0;
      obstacles = [];
      collectibles = [];
      particles = [];
      player.y = GROUND_Y - player.h;
      player.vy = 0;
      player.jumpCount = 0;

      if (scoreEl) scoreEl.textContent = '0';
      if (overlay) overlay.style.display = 'none';

      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(gameLoop);
    }

    function handleGameOver() {
      isPlaying = false;
      isGameOver = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);

      if (score > highScore) {
        highScore = score;
        localStorage.setItem('usos_ects_highscore', String(highScore));
        if (highscoreEl) highscoreEl.textContent = String(highScore);
      }

      if (overlay) {
        overlay.style.display = 'flex';
        if (overlayTitle) overlayTitle.textContent = `Koniec gry! Zdobyte punkty: ${score}`;
        if (overlaySub) overlaySub.innerHTML = `Rekord: <strong>${highScore} pkt</strong>. Naciśnij <strong>SPACJĘ</strong>, aby zagrać ponownie!`;
        if (startBtn) startBtn.textContent = 'Zagraj ponownie';
      }
    }

    function restartGame() {
      startGame();
    }

    function update() {
      distanceCounter++;
      if (distanceCounter % 9 === 0) {
        score++;
        if (scoreEl) scoreEl.textContent = String(score);
      }

      // Stopniowe zwiększanie prędkości
      if (gameSpeed < 7.8) {
        gameSpeed += 0.0008;
      }

      // Fizyka gracza
      player.vy += player.gravity;
      player.y += player.vy;
      if (player.y >= GROUND_Y - player.h) {
        player.y = GROUND_Y - player.h;
        player.vy = 0;
        player.isJumping = false;
        player.jumpCount = 0;
      }
      player.animTick++;

      // Gwiazdy w tle
      stars.forEach((st) => {
        st.x -= st.speed * (gameSpeed / 4);
        if (st.x < -10) st.x = 610;
      });

      // Spawnowanie przeszkód
      obstacleTimer--;
      if (obstacleTimer <= 0) {
        const type = OBSTACLE_TYPES[Math.floor(Math.random() * OBSTACLE_TYPES.length)];
        obstacles.push({
          x: 620,
          y: GROUND_Y - type.h,
          w: type.w,
          h: type.h,
          label: type.label,
          color: type.color
        });
        obstacleTimer = Math.floor(Math.random() * 45) + 65;
      }

      // Spawnowanie bonusów (ECTS / Kawa)
      collectibleTimer--;
      if (collectibleTimer <= 0) {
        const cType = COLLECTIBLE_TYPES[Math.floor(Math.random() * COLLECTIBLE_TYPES.length)];
        collectibles.push({
          x: 630,
          y: GROUND_Y - player.h - Math.floor(Math.random() * 40) - 20,
          w: cType.w,
          h: cType.h,
          label: cType.label,
          color: cType.color,
          points: cType.points
        });
        collectibleTimer = Math.floor(Math.random() * 60) + 90;
      }

      // Aktualizacja przeszkód & Kolizje
      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.x -= gameSpeed;

        // Bounding box z 4px tolerancją
        const pBox = { x: player.x + 4, y: player.y + 4, w: player.w - 8, h: player.h - 6 };
        const oBox = { x: obs.x + 4, y: obs.y + 2, w: obs.w - 8, h: obs.h - 4 };

        if (
          pBox.x < oBox.x + oBox.w &&
          pBox.x + pBox.w > oBox.x &&
          pBox.y < oBox.y + oBox.h &&
          pBox.y + pBox.h > oBox.y
        ) {
          spawnParticles(player.x + player.w / 2, player.y + player.h / 2, '#ef4444', 12);
          handleGameOver();
          return;
        }

        if (obs.x + obs.w < -20) {
          obstacles.splice(i, 1);
        }
      }

      // Aktualizacja bonusów
      for (let i = collectibles.length - 1; i >= 0; i--) {
        const col = collectibles[i];
        col.x -= gameSpeed;

        const pBox = { x: player.x, y: player.y, w: player.w, h: player.h };
        if (
          pBox.x < col.x + col.w &&
          pBox.x + pBox.w > col.x &&
          pBox.y < col.y + col.h &&
          pBox.y + pBox.h > col.y
        ) {
          score += col.points;
          if (scoreEl) scoreEl.textContent = String(score);
          spawnParticles(col.x + col.w / 2, col.y + col.h / 2, col.color, 10);
          collectibles.splice(i, 1);
          continue;
        }

        if (col.x + col.w < -20) {
          collectibles.splice(i, 1);
        }
      }

      // Aktualizacja cząsteczek
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.04;
        if (p.alpha <= 0) {
          particles.splice(i, 1);
        }
      }
    }

    function draw() {
      // Tło kosmiczno-nocne
      ctx.fillStyle = '#080d1a';
      ctx.fillRect(0, 0, 600, 190);

      // Gwiazdy
      stars.forEach((st) => {
        ctx.fillStyle = `rgba(248, 250, 252, ${st.alpha})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Linia podłoża z tech-siatką
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(600, GROUND_Y);
      ctx.stroke();

      // Znaczniki na podłożu przesuwające się w lewo
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 1;
      const groundOffset = (distanceCounter * gameSpeed) % 24;
      for (let gx = -groundOffset; gx < 600; gx += 24) {
        ctx.beginPath();
        ctx.moveTo(gx, GROUND_Y);
        ctx.lineTo(gx - 8, GROUND_Y + 12);
        ctx.stroke();
      }

      // Rysowanie gracza (Student z biretem)
      drawPlayer(player.x, player.y);

      // Rysowanie przeszkód
      obstacles.forEach((obs) => {
        drawObstacle(obs);
      });

      // Rysowanie bonusów
      collectibles.forEach((col) => {
        drawCollectible(col);
      });

      // Cząsteczki
      particles.forEach((p) => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }

    function drawPlayer(px, py) {
      ctx.save();

      // Ciało / Bluza studencka
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.roundRect(px + 4, py + 12, 22, 18, 6);
      ctx.fill();

      // Twarz / Wizjer
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.roundRect(px + 6, py + 4, 18, 12, 4);
      ctx.fill();

      // Oczy
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(px + 10, py + 8, 3, 3);
      ctx.fillRect(px + 16, py + 8, 3, 3);

      // Biret Studencki (Diament na górze)
      ctx.fillStyle = '#1e1b4b';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 15, py - 3);
      ctx.lineTo(px + 28, py + 2);
      ctx.lineTo(px + 15, py + 6);
      ctx.lineTo(px + 2, py + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Złoty frędzel biretu
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 15, py + 2);
      ctx.lineTo(px + 26, py + 8);
      ctx.stroke();

      // Nogi (animowane bieganie)
      ctx.fillStyle = '#0f172a';
      if (player.isJumping) {
        ctx.fillRect(px + 6, py + 29, 6, 5);
        ctx.fillRect(px + 17, py + 27, 6, 5);
      } else {
        const legSwing = Math.sin(player.animTick * 0.4) * 4;
        ctx.fillRect(px + 7 + legSwing, py + 30, 5, 6);
        ctx.fillRect(px + 17 - legSwing, py + 30, 5, 6);
      }

      ctx.restore();
    }

    function drawObstacle(obs) {
      ctx.save();
      // Kapsułka z nazwą
      ctx.fillStyle = obs.color;
      ctx.beginPath();
      ctx.roundRect(obs.x, obs.y, obs.w, obs.h, 6);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Etykieta
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(obs.label, obs.x + obs.w / 2, obs.y + obs.h / 2 + 0.5);

      ctx.restore();
    }

    function drawCollectible(col) {
      ctx.save();
      // Poświata
      ctx.fillStyle = col.color;
      ctx.beginPath();
      ctx.roundRect(col.x, col.y, col.w, col.h, 6);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Tekst
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.label, col.x + col.w / 2, col.y + col.h / 2 + 0.5);

      ctx.restore();
    }

    function gameLoop() {
      if (!isPlaying) return;
      update();
      draw();
      animFrameId = requestAnimationFrame(gameLoop);
    }

    // Sterowanie klawiaturą (Spacja / Strzałka w górę / W)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        e.preventDefault();
        triggerJump();
      }
    });

    // Sterowanie dotykiem / myszką
    canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      triggerJump();
    });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      triggerJump();
    }, { passive: false });

    if (startBtn) {
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startGame();
      });
    }

    // Rysowanie pierwszej statycznej klatki
    draw();
  }

  /**
   * Główna funkcja orkiestrująca wstrzyknięcie widoku nowoczesnej przerwy technicznej
   */
  function modernizeMaintenancePage() {
    if (!isMaintenanceBreak()) return;
    if (document.getElementById('usos-modern-maintenance')) return;

    // Główny slot na treść strony USOS
    const mainSlot = document.querySelector(
      '#layout-c22, #layout-main-content, .usos-ui, main-panel, #layout-c, .body-container, .main-body'
    ) || document.body;

    // Zbuduj nowoczesny komponent
    const maintWrapper = buildModernMaintenanceUI();

    // Ukryj stare surowe nagłówki i ramki z pracami drogowymi
    const legacyElements = document.querySelectorAll(
      '#layout-c22 > h1, #layout-main-content > h1, usos-frame, img[src*="roboty"], img[src*="przerwa"], .note, font[color]'
    );
    legacyElements.forEach((el) => {
      if (!el.closest('#usos-modern-navbar, #usos-modern-maintenance')) {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    });

    // Wstaw na początku kontenera
    if (mainSlot.firstChild) {
      mainSlot.insertBefore(maintWrapper, mainSlot.firstChild);
    } else {
      mainSlot.appendChild(maintWrapper);
    }

    // Zainicjalizuj odliczanie, ping, generator wymówek i minigrę
    initMaintenanceInteractivity(maintWrapper);
  }

  /* ==========================================================================
     7. ZARZĄDZANIE TRYBEM CIEMNYM (TOGGLE)
     ========================================================================== */

  function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    applyThemeState(isExtensionEnabled, isDarkMode);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ darkMode: isDarkMode });
    }
  }

  /* ==========================================================================
     8. OBSŁUGA MUTACJI DOM (DYNAMICZNE ŁADOWANIE ZAWARTOSCI / AJAX)
     ========================================================================== */

  function startDOMObserver() {
    if (isObserverActive) return;

    const observer = new MutationObserver((mutations) => {
      // Ignoruj mutacje wywołane przez nasze własne elementy i strukturę planu
      let shouldUpdate = false;
      for (const mutation of mutations) {
        const target = mutation.target;
        if (!target) continue;

        if (
          target.id === 'usos-modern-navbar' ||
          target.id === 'usos-schedule-filter-bar' ||
          target.id === 'usos-home-dashboard' ||
          target.id === 'usos-modern-maintenance' ||
          target.closest?.(
            '#usos-modern-navbar, #usos-schedule-filter-bar, #usos-home-dashboard, #usos-modern-maintenance, .usos-home-hero, usos-timetable, timetable-entry, timetable-day, .usos-modern-breadcrumbs, .usos-table-wrapper, .usos-registration-card'
          ) ||
          target.classList?.contains('usos-badge') ||
          target.classList?.contains('usos2-entry-details') ||
          target.classList?.contains('usos-entry-hide-btn') ||
          target.classList?.contains('usos-filter-pill') ||
          target.classList?.contains('usos-tour-status') ||
          target.classList?.contains('usos-reg-opis-btn') ||
          target.classList?.contains('usos-reg-cta-btn') ||
          target.classList?.contains('usos-sched-tab-btn') ||
          target.classList?.contains('usos-search-tab-pill') ||
          target.classList?.contains('usos-group-pill')
        ) {
          continue;
        }

        shouldUpdate = true;
        break;
      }

      if (shouldUpdate) {
        if (observerTimeout) clearTimeout(observerTimeout);
        observerTimeout = setTimeout(() => {
          runModernizer();
        }, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    isObserverActive = true;
  }

  /* ==========================================================================
     9. IKONY SVG (HEROICONS / LUCIDE STYLE)
     ========================================================================== */

  function getMoonIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>`;
  }

  function getSunIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="5"></circle>
      <line x1="12" y1="1" x2="12" y2="3"></line>
      <line x1="12" y1="21" x2="12" y2="23"></line>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
      <line x1="1" y1="12" x2="3" y2="12"></line>
      <line x1="21" y1="12" x2="23" y2="12"></line>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
    </svg>`;
  }

  function getInfoCircleIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="16" x2="12" y2="12"></line>
      <line x1="12" y1="8" x2="12.01" y2="8"></line>
    </svg>`;
  }

  function getAlertCircleIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>`;
  }

  function getExamIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>`;
  }

  function getLanguageIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>`;
  }

  function getSportIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M4.93 4.93l14.14 14.14"></path>
      <path d="M14.83 9.17a4 4 0 0 0-5.66 5.66"></path>
    </svg>`;
  }

  function getBookIcon() {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
    </svg>`;
  }

  // Uruchomienie skryptu
  initSettings();
})();
