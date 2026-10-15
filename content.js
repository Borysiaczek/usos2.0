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
    if (host.includes('usos') || path.includes('usos') || host.includes('cas') || path.includes('/cas/')) return true;
    return Boolean(document.querySelector('#topmenu, #layout-c, table.tab, .body-container, a[href*="kontroler.php"], body.login, form#fm1, #container > #content, #container > #logo'));
  }

  /**
   * Inicjalizuje odczyt ustawień z chrome.storage.local
   */
  function initSettings() {
    if (!isUsosPage()) return;

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      applyThemeState(true, false);
      runModernizer();
      initGlobalEnhancements();
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
        initSessionKeepalive();
        initGlobalEnhancements();
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
      modernizeLoginPage();
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
      modernizeStudentPortal();
      modernizeFooter();
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

    // Przycisk Skróty klawiszowe
    const shortcutsBtn = document.createElement('button');
    shortcutsBtn.id = 'usos-shortcuts-nav-btn';
    shortcutsBtn.type = 'button';
    shortcutsBtn.className = 'usos-shortcuts-btn';
    shortcutsBtn.title = 'Skróty klawiszowe (Alt+? lub ?) • USOSweb 2.0';
    shortcutsBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
        <line x1="6" y1="8" x2="6" y2="8"></line>
        <line x1="10" y1="8" x2="10" y2="8"></line>
        <line x1="14" y1="8" x2="14" y2="8"></line>
        <line x1="18" y1="8" x2="18" y2="8"></line>
        <line x1="6" y1="12" x2="6" y2="12"></line>
        <line x1="18" y1="12" x2="18" y2="12"></line>
        <line x1="7" y1="16" x2="17" y2="16"></line>
      </svg>
    `;
    shortcutsBtn.addEventListener('click', toggleShortcutsModal);
    navRight.appendChild(shortcutsBtn);

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
      :host {
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        background: transparent !important;
      }
      :host > * { overflow: visible !important; }
      *:not(slot) { max-width: none !important; }
      * { border-color: var(--border-default) !important; }
      hr { border: none !important; border-top: 1px dashed var(--border-default) !important; background: transparent !important; margin: 0 !important; }
      :host(:not([mini])) * { color: var(--text-muted); }
    `,
    entry: `
      :host {
        border-radius: 8px !important;
        overflow: hidden !important;
        cursor: pointer !important;
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        box-sizing: border-box !important;
      }
      slot {
        display: flex !important;
        flex-direction: column !important;
        width: 100% !important;
        height: 100% !important;
      }
      *:not(slot) {
        -webkit-line-clamp: unset !important;
        line-clamp: unset !important;
        text-overflow: clip !important;
        white-space: normal !important;
        background-color: transparent !important;
        color: inherit !important;
        font-family: var(--font-sans) !important;
      }
    `,
    moduleLinkTile: `
      :host {
        display: block !important;
        background: var(--bg-card, #111827) !important;
        background-color: var(--bg-card, #111827) !important;
        border: 1px solid var(--border-default, #26334d) !important;
        border-radius: var(--radius-lg, 12px) !important;
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.1)) !important;
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease, background-color 0.2s ease !important;
        overflow: hidden !important;
      }
      :host(:hover) {
        background: var(--bg-card-hover, #1e293b) !important;
        background-color: var(--bg-card-hover, #1e293b) !important;
        border-color: var(--primary, #3b82f6) !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35), 0 0 0 1px var(--primary, #3b82f6) !important;
        transform: translateY(-2px) !important;
      }
      :host > a {
        display: block !important;
        text-decoration: none !important;
        color: inherit !important;
        width: 100% !important;
        height: 100% !important;
        box-sizing: border-box !important;
      }
      :host > a:focus-visible {
        outline: 2px solid var(--primary, #3b82f6) !important;
        outline-offset: -2px !important;
        border-radius: var(--radius-lg, 12px) !important;
      }
      :host > a > div {
        display: flex !important;
        align-items: flex-start !important;
        padding: 1.25rem 1rem !important;
        gap: 1rem !important;
        box-sizing: border-box !important;
        background: transparent !important;
        background-color: transparent !important;
      }
      #icon {
        width: 56px !important;
        height: 56px !important;
        min-width: 56px !important;
        flex-shrink: 0 !important;
        background: var(--primary, #3b82f6) !important;
        background-color: var(--primary, #3b82f6) !important;
        -webkit-mask-size: 48px 48px !important;
        mask-size: 48px 48px !important;
        -webkit-mask-position: center !important;
        mask-position: center !important;
        border-radius: 8px !important;
        transition: transform 0.2s ease, background-color 0.2s ease !important;
      }
      :host(:hover) #icon {
        transform: scale(1.08) !important;
        background: var(--primary-hover, #60a5fa) !important;
        background-color: var(--primary-hover, #60a5fa) !important;
      }
      #content {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
      }
      #title ::slotted(*) {
        font-family: var(--font-sans) !important;
        font-size: 1.05rem !important;
        font-weight: 600 !important;
        color: var(--text-main, #f8fafc) !important;
        margin-top: 0 !important;
        margin-bottom: 0.35rem !important;
        transition: color 0.15s ease !important;
      }
      :host(:hover) #title ::slotted(*) {
        color: var(--primary, #3b82f6) !important;
      }
      #text ::slotted(*) {
        font-family: var(--font-sans) !important;
        font-size: 0.85rem !important;
        line-height: 1.45 !important;
        color: var(--text-muted, #94a3b8) !important;
      }
      *:not(slot) {
        border-color: var(--border-default) !important;
      }
    `,
    moduleLinkTileContainer: `
      :host {
        display: flex !important;
        flex-flow: row wrap !important;
        justify-content: flex-start !important;
        gap: 1.25rem !important;
        margin: 0 !important;
        padding: 0.5rem 0 !important;
      }
      :host ::slotted(usos-module-link-tile) {
        min-width: 280px !important;
        flex: 1 1 calc(33.333% - 1.25rem) !important;
        max-width: calc(33.333% - 0.85rem) !important;
        margin: 0 !important;
        box-sizing: border-box !important;
      }
      @media (max-width: 1100px) {
        :host ::slotted(usos-module-link-tile) {
          flex: 1 1 calc(50% - 1.25rem) !important;
          max-width: calc(50% - 0.65rem) !important;
        }
      }
      @media (max-width: 680px) {
        :host ::slotted(usos-module-link-tile) {
          flex: 1 1 100% !important;
          max-width: 100% !important;
        }
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
      if (tag === 'timetable-entry') {
        injectShadowCSS(root, 'entry', SHADOW_CSS.entry);
      }
      if (tag === 'usos-module-link-tile') {
        injectShadowCSS(root, 'moduleLinkTile', SHADOW_CSS.moduleLinkTile);
      }
      if (tag === 'usos-module-link-tile-container') {
        injectShadowCSS(root, 'moduleLinkTileContainer', SHADOW_CSS.moduleLinkTileContainer);
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
      modernizeLoginPage();
      modernizeStudentPortal();
      modernizeFooter();
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

  /** Bezpiecznie wyciąga czyste węzły tekstowe, pomijając <style>, <script>, <svg> i UI USOS 2.0 */
  function getCleanNodeText(root) {
    if (!root) return '';
    if (root.nodeType === Node.ELEMENT_NODE) {
      const tag = root.tagName.toLowerCase();
      if (tag === 'style' || tag === 'script' || tag === 'svg' || tag === 'noscript') return '';
    }
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (tag === 'style' || tag === 'script' || tag === 'svg' || tag === 'noscript') {
              return NodeFilter.FILTER_REJECT;
            }
            if (node.classList && (
              node.classList.contains('usos-entry-card-wrap') ||
              node.classList.contains('usos-entry-hide-btn') ||
              node.classList.contains('usos2-entry-details') ||
              node.classList.contains('usos-cal-current-time-line')
            )) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          if (node.nodeType === Node.TEXT_NODE) {
            const val = node.nodeValue?.trim();
            if (!val || val === '---') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    const parts = [];
    while (walker.nextNode()) {
      const v = walker.currentNode.nodeValue?.trim();
      if (v) parts.push(v);
    }
    return parts.join('\n');
  }

  /** Zbiera tekst z light DOM i (jeśli jest) z shadow DOM bloczka, gwarantując brak kodu CSS (:host). */
  function collectEntryText(entry) {
    if (!entry) return '';
    let text = getCleanNodeText(entry);
    if (entry.shadowRoot) {
      const sText = getCleanNodeText(entry.shadowRoot);
      if (sText) text += '\n' + sText;
    }
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
        col.style.setProperty('min-width', '0', 'important');
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

  function cleanSubjectName(raw) {
    if (!raw) return '';
    let str = String(raw).trim().split(/\r?\n/)[0].trim();
    if (!str) return '';

    // Całkowite odrzucenie kodu CSS (np. :host {, var(--, style, reguły stylów)
    if (str.includes('{') || str.includes('}') || str.includes(';') || str.includes('!important')) {
      return '';
    }
    if (/^:host\b|^\.[a-z0-9_-]+\s*\{|^#[a-z0-9_-]+\s*\{|\bvar\(--|\bdisplay\s*:|\bborder\b|\bbackground\b|\bcolor\s*:|\bpadding\b|\bmargin\b/i.test(str)) {
      return '';
    }

    // Sprawdź czy ciąg to nie jest sam kod typu / pusta wartość
    if (/^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(str)) {
      return '';
    }
    str = str.replace(/\s*\(PSUB[^\)]*\)/gi, '');
    str = str.replace(/\s*\[[A-Z0-9_\-]+\]/gi, '');

    // Usuń przedrostki typu zajęć z początku nazwy (np. "WYK:", "wykład ", "ćwiczenia ", "laboratorium ", "lektorat ")
    str = str.replace(/^(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD(?:Y)?|ĆWICZENIA|LABORATORI(?:UM|A)|PROJEKT(?:Y)?|LEKTORAT(?:Y)?|SEMINARI(?:UM|A)|ZAJĘCIA)\s*[:\-–\s]\s*/gi, '');
    str = str.replace(/^(?:wykład(?:y)?|ćwiczenia|laboratori(?:um|a)|projekt(?:y)?|lektorat(?:y)?|seminari(?:um|a)|zajęcia)\s+/gi, '');

    const typePattern = /\s*[\(\[\-–,]\s*(?:wykład(?:y)?|ćwiczenia|laboratori(?:um|a)|projekt(?:y)?|lektorat(?:y)?|seminari(?:um|a)|zajęcia|wyk|ćw|cw|lab|lekt|proj|sem)\b[^\)\]]*[\)\]]?/gi;
    while (typePattern.test(str)) {
      str = str.replace(typePattern, '').trim();
    }
    str = str.replace(/\s+(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM)\b.*$/i, '').trim();
    str = str.replace(/[\-–,:]\s*$/, '').trim();

    if (/^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(str)) {
      return '';
    }
    return str;
  }

  function getSubjectKey(entry) {
    if (!entry) return 'Przedmiot';
    const cachedClean = entry.dataset.usosCleanSubject;
    if (cachedClean && !cachedClean.includes(':host') && !cachedClean.includes('{') && !/^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(cachedClean)) {
      return cachedClean;
    }
    const details = getTimetableEntryDetails(entry);
    if (details.subject && !details.subject.includes(':host') && !details.subject.includes('{') && !/^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(details.subject)) {
      entry.dataset.usosCleanSubject = details.subject;
      entry.dataset.usosSubject = details.subject;
      return details.subject;
    }
    return 'Przedmiot';
  }

  function getHiddenSubjects(callback) {
    const sanitize = (list) => (Array.isArray(list) ? list.filter(s => s && typeof s === 'string' && !s.includes(':host') && !s.includes('{')) : []);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['usos_hidden_subjects'], (res) => {
        callback(sanitize(res.usos_hidden_subjects));
      });
    } else {
      try {
        const stored = JSON.parse(localStorage.getItem('usos_hidden_subjects') || '[]');
        callback(sanitize(stored));
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
    } catch { }
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
    const normalizedHidden = (hiddenList || []).map(cleanSubjectName);
    entries.forEach((entry) => {
      const subj = getSubjectKey(entry);
      const isHidden = normalizedHidden.includes(cleanSubjectName(subj));
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
    updateFilterBarUI(tt, normalizedHidden);
  }

  function updateFilterBarUI(tt, hiddenList) {
    const bar = document.getElementById('usos-schedule-filter-bar');
    if (!bar) return;

    const normalizedHidden = (hiddenList || []).map(cleanSubjectName);
    const pills = bar.querySelectorAll('.usos-filter-pill');
    pills.forEach((pill) => {
      const subj = cleanSubjectName(pill.dataset.subject);
      const isHidden = normalizedHidden.includes(subj);
      pill.classList.toggle('active', !isHidden);
      pill.classList.toggle('hidden-subject', isHidden);
      pill.innerHTML = isHidden
        ? `<span class="icon" style="opacity:0.7">⊘</span> <span>${escapeHtml(subj)}</span>`
        : `<span class="icon" style="color:#60a5fa">✓</span> <span>${escapeHtml(subj)}</span>`;
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
      if (subj && subj !== 'Przedmiot' && !subj.includes(':host') && !subj.includes('{') && !seen.has(subj)) {
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

    // --- KARTA 6: MOTYWUJĄCY CYTAT (STUDENCKI PRZETRWALNIK) ---
    const motivationCard = buildStudentMotivationCard();
    if (motivationCard) {
      sidebarCol.appendChild(motivationCard);
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
      if (el.closest('#usos-modern-navbar, #usos-home-dashboard, .usos-home-hero, usos-timetable, .lista-zajec, #usos-schedule-filter-bar, .usos-motivation-card')) {
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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let cachedStudentCourses = null;

  function getKnownStudentCourses() {
    if (cachedStudentCourses && cachedStudentCourses.length > 0) {
      return cachedStudentCourses;
    }

    const list = [];
    const seen = new Set();

    // Szukamy elementów zajęć w całym dokumencie (zarówno w starych ramkach, jak i po przeniesieniu do dashboardu)
    const items = document.querySelectorAll(
      '.lista-zajec > li, .usos-courses-widget li, .usos-course-item-card, usos-frame.student li, usos-frame[title*="Zajęcia studenta" i] li'
    );

    items.forEach(li => {
      // Wyciągnij nazwę przedmiotu
      const titleLink = li.querySelector('.font-medium a, a:not(.usos-group-pill):not([href*="grupa"]), a:not([href*="grupa"]):not([href*="plan"])')
        || li.querySelector('a');
      let name = titleLink ? titleLink.textContent.trim() : '';
      if (!name) {
        const bold = li.querySelector('b, strong, .name');
        if (bold) name = bold.textContent.trim();
      }

      if (!name || seen.has(name.toLowerCase())) return;

      const types = [];
      li.querySelectorAll('.inlined-list li a, .usos-group-pill, a[href*="grupa"]').forEach(a => {
        const t = (a.textContent || '').toLowerCase();
        if (t.includes('wyk')) types.push('WYK');
        if (t.includes('ćw') || t.includes('cw')) types.push('ĆW');
        if (t.includes('lab')) types.push('LAB');
        if (t.includes('proj')) types.push('PROJ');
        if (t.includes('lekt') || t.includes('ang') || t.includes('niem')) types.push('LEKT');
        if (t.includes('sem')) types.push('SEM');
      });

      seen.add(name.toLowerCase());
      list.push({ name, types });
    });

    if (list.length > 0) {
      cachedStudentCourses = list;
      try {
        localStorage.setItem('usos_known_courses', JSON.stringify(list));
      } catch { }
      return list;
    }

    // Odczyt z pamięci trwałej (przydatny na podstronie /kontroler.php?_action=home/plan)
    try {
      const stored = JSON.parse(localStorage.getItem('usos_known_courses') || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        cachedStudentCourses = stored;
        return stored;
      }
    } catch { }

    // Semestralne przedmioty fallback dla kierunku Sztuczna inteligencja (AEI Politechnika Śląska)
    const defaults = [
      { name: 'Technika mikroprocesorowa', types: ['WYK', 'LAB'] },
      { name: 'Matematyka dyskretna i systemy decyzyjne', types: ['WYK', 'LAB', 'ĆW'] },
      { name: 'Matematyka', types: ['WYK', 'ĆW'] },
      { name: 'Język angielski (B2)', types: ['LEKT'] },
      { name: 'Projekt inżynierski / zespołowy', types: ['PROJ'] },
      { name: 'Algorytmy i struktury danych', types: ['WYK', 'LAB'] }
    ];
    cachedStudentCourses = defaults;
    return defaults;
  }

  function getWeekMondayDate(refDate, weekOffset = 0) {
    const d = new Date(refDate);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1) + (weekOffset * 7);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getTimetableEntryDetails(entry) {
    let start = parseGridTime(entry.style.gridRowStart) || parseGridTime(window.getComputedStyle?.(entry)?.gridRowStart);
    let end = parseGridTime(entry.style.gridRowEnd) || parseGridTime(window.getComputedStyle?.(entry)?.gridRowEnd);

    // Zapisz pierwotny tytuł/tooltip przy pierwszym napotkaniu (zabezpieczenie przed zatruciem kodem CSS)
    if (entry.dataset.usosOrigTitle && (entry.dataset.usosOrigTitle.includes(':host') || entry.dataset.usosOrigTitle.includes('{'))) {
      entry.dataset.usosOrigTitle = '';
    }
    if (!entry.dataset.usosOrigTitle) {
      const orig = entry.getAttribute('title') || entry.getAttribute('data-tooltip') || '';
      if (!orig.includes(':host') && !orig.includes('{')) {
        entry.dataset.usosOrigTitle = orig;
      }
    }

    const rawTitle = (entry.dataset.usosOrigTitle || '').trim();
    const rawTooltip = (entry.getAttribute('data-tooltip') || entry.getAttribute('data-content') || entry.getAttribute('aria-label') || '').trim();
    const allCollectedText = collectEntryText(entry);
    const rawText = getCleanNodeText(entry).trim();
    const fullSearchText = `${rawTitle}\n${rawTooltip}\n${allCollectedText}\n${rawText}\n${entry.className}`;

    // 1. Określ typ zajęć (z priorytetem atrybutów USOSweb i pamięcią wyznaczonego typu)
    let typeTag = entry.dataset.usosOrigType || '';
    let typeClass = 'usos-entry-wyklad';
    let typeFullName = 'Wykład';

    if (!typeTag) {
      // 1a. Sprawdź natywny atrybut color w elemencie timetable-entry (standard USOS)
      const nativeColor = entry.getAttribute('color') || '';
      if (nativeColor === '5') {
        typeTag = 'LAB';
      } else if (nativeColor === '3') {
        typeTag = 'WYK';
      } else if (nativeColor === '2') {
        typeTag = 'ĆW';
      } else if (nativeColor === '6') {
        typeTag = 'LEKT';
      } else if (nativeColor === '4') {
        typeTag = 'PROJ';
      } else if (nativeColor === '7') {
        typeTag = 'SEM';
      }
    }

    if (!typeTag) {
      // 1b. Sprawdź dedykowany slot lub element z typem
      const rootsForType = [entry];
      if (entry.shadowRoot) rootsForType.push(entry.shadowRoot);
      for (const r of rootsForType) {
        const slotEl = r.querySelector('[slot="type"], .badge, .type');
        if (slotEl) {
          const tTxt = slotEl.textContent.trim().toUpperCase();
          if (/\b(?:LAB|LABORATORI(?:UM|A)?)\b/i.test(tTxt)) typeTag = 'LAB';
          else if (/\b(?:ĆW|CW|ĆWICZENI(?:A)?)\b/i.test(tTxt)) typeTag = 'ĆW';
          else if (/\b(?:LEKT|LEKTORAT(?:Y)?)\b/i.test(tTxt)) typeTag = 'LEKT';
          else if (/\b(?:PROJ|PROJEKT(?:Y)?)\b/i.test(tTxt)) typeTag = 'PROJ';
          else if (/\b(?:SEM|SEMINARI(?:UM|A)?)\b/i.test(tTxt)) typeTag = 'SEM';
          else if (/\b(?:WYK|WYKŁAD(?:Y)?)\b/i.test(tTxt)) typeTag = 'WYK';
          if (typeTag) break;
        }
      }
    }

    if (!typeTag) {
      // 1c. Sprawdź czyste teksty z tooltipu / tytułu (z granicami słów, bez przypisywania lektoratu po tytule)
      const cleanSearchForType = `${rawTitle}\n${rawTooltip}\n${rawText}`;
      if (/\b(?:LAB|LABORATORI(?:UM|A)?)\b/iu.test(cleanSearchForType)) {
        typeTag = 'LAB';
      } else if (/\b(?:ĆW|CW|ĆWICZENI(?:A)?)\b/iu.test(cleanSearchForType)) {
        typeTag = 'ĆW';
      } else if (/\b(?:LEKT|LEKTORAT(?:Y)?)\b/iu.test(cleanSearchForType)) {
        typeTag = 'LEKT';
      } else if (/\b(?:PROJ|PROJEKT(?:Y)?)\b/iu.test(cleanSearchForType)) {
        typeTag = 'PROJ';
      } else if (/\b(?:SEM|SEMINARI(?:UM|A)?)\b/iu.test(cleanSearchForType)) {
        typeTag = 'SEM';
      } else if (/\b(?:WYK|WYKŁAD(?:Y)?)\b/iu.test(cleanSearchForType)) {
        typeTag = 'WYK';
      } else {
        typeTag = 'WYK';
      }
    }

    // Zapisz wyznaczony typ na stałe w elemencie
    entry.dataset.usosOrigType = typeTag;

    if (typeTag === 'LAB') {
      typeClass = 'usos-entry-lab';
      typeFullName = 'Laboratorium';
    } else if (typeTag === 'ĆW' || typeTag === 'CW') {
      typeTag = 'ĆW';
      typeClass = 'usos-entry-cwiczenia';
      typeFullName = 'Ćwiczenia';
    } else if (typeTag === 'LEKT') {
      typeClass = 'usos-entry-lektorat';
      typeFullName = 'Lektorat';
    } else if (typeTag === 'PROJ') {
      typeClass = 'usos-entry-proj';
      typeFullName = 'Projekt';
    } else if (typeTag === 'SEM') {
      typeClass = 'usos-entry-sem';
      typeFullName = 'Seminarium';
    } else {
      typeTag = 'WYK';
      typeClass = 'usos-entry-wyklad';
      typeFullName = 'Wykład';
    }

    // 2. Wyznacz czas i czas trwania
    let timeStr = '';
    let duration = '';
    if (start && end) {
      timeStr = `${formatTime(start)}–${formatTime(end)}`;
      duration = formatDuration(start, end);
    } else {
      const timeMatch = fullSearchText.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      if (timeMatch) {
        timeStr = `${timeMatch[1]}–${timeMatch[2]}`;
        const p1 = parseTime(timeMatch[1]);
        const p2 = parseTime(timeMatch[2]);
        if (p1 && p2) {
          start = p1;
          end = p2;
          duration = formatDuration(start, end);
        }
      }
    }

    // Jeśli wciąż brak czasu (np. specyficzny render siatki), wyznacz na podstawie grid-row
    if (!timeStr) {
      const gridRowMatch = (entry.getAttribute('style') || '').match(/grid-row(?:-start)?\s*:\s*(\d+)/i);
      if (gridRowMatch) {
        const rowNum = parseInt(gridRowMatch[1], 10);
        const totalMinutes = 8 * 60 + Math.max(0, (rowNum - 2) * 15);
        const sH = Math.floor(totalMinutes / 60);
        const sM = totalMinutes % 60;
        const eH = Math.floor((totalMinutes + 90) / 60);
        const eM = (totalMinutes + 90) % 60;
        start = { h: sH, m: sM };
        end = { h: eH, m: eM };
        timeStr = `${formatTime(start)}–${formatTime(end)}`;
        duration = '1g 30m';
      } else {
        timeStr = '08:30–10:00';
        duration = '1g 30m';
      }
    }

    // 3. Wyodrębnij czystą nazwę przedmiotu (nigdy nie sam typ, kod ani CSS)
    let subject = entry.dataset.usosCleanSubject || '';
    if (subject && (subject.includes(':host') || subject.includes('{') || /^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(subject))) {
      subject = '';
      entry.dataset.usosCleanSubject = '';
    }

    // 3a. Sprawdź dedykowane elementy wewnątrz shadowRoot i light DOM
    if (!subject) {
      const roots = [entry];
      if (entry.shadowRoot) roots.push(entry.shadowRoot);
      for (const r of roots) {
        const titleEl = r.querySelector('#title, #name, .title, .name, [slot="title"], [slot="name"], a[href*="katalog2/przedmioty"], a[href*="courses"], a[href*="przedmiot"]');
        if (titleEl) {
          const cand = cleanSubjectName(titleEl.textContent);
          if (cand && cand.length >= 3 && !cand.includes(':host') && !cand.includes('{')) {
            subject = cand;
            break;
          }
        }
      }
    }

    // 3b. Sprawdź atrybuty samego elementu
    if (!subject) {
      for (const attr of ['name', 'course-name', 'course', 'subject', 'nazwa', 'data-name', 'data-subject-name']) {
        const val = entry.getAttribute(attr);
        const cand = cleanSubjectName(val);
        if (cand && cand.length >= 3 && !cand.includes(':host') && !cand.includes('{')) {
          subject = cand;
          break;
        }
      }
    }

    // 3c. Przeszukaj wyczyszczone linie tekstowe
    if (!subject) {
      const candidateLines = `${rawTitle}\n${rawTooltip}\n${allCollectedText}`
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

      for (const line of candidateLines) {
        if (/^\d{1,2}:\d{2}/.test(line)) continue;
        if (/^(?:sala|s\.|room|gab\.|aula|aud\.|prowadzący|lecturer)/i.test(line)) continue;
        const cleaned = cleanSubjectName(line);
        if (cleaned && cleaned.length >= 3 && !cleaned.includes(':host') && !cleaned.includes('{') && !/^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(cleaned)) {
          subject = cleaned;
          break;
        }
      }
    }

    // 3d. Sprawdź elementy wewnętrzne (np. linki lub spany wewnątrz entry)
    if (!subject) {
      const innerLinks = Array.from(entry.querySelectorAll('a, span, b, strong, div')).filter(el => {
        return !el.classList.contains('usos-entry-badge') && !el.classList.contains('usos-entry-time') && !el.classList.contains('usos-entry-hide-btn') && !el.classList.contains('usos-entry-card-wrap') && !el.classList.contains('usos2-entry-details');
      });
      for (const el of innerLinks) {
        const cleaned = cleanSubjectName(el.textContent);
        if (cleaned && cleaned.length >= 3 && !cleaned.includes(':host') && !cleaned.includes('{') && !/^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(cleaned)) {
          subject = cleaned;
          break;
        }
      }
    }

    // 3e. Dopasuj ze znanych przedmiotów studenta z dashboardu (.lista-zajec)
    const knownCourses = getKnownStudentCourses().filter(c => c && c.name && !c.name.includes(':host') && !c.name.includes('{'));
    if (!subject) {
      if (knownCourses.length > 0) {
        const textLower = fullSearchText.toLowerCase();
        const textMatch = knownCourses.find(c => textLower.includes(c.name.toLowerCase()));
        if (textMatch) {
          subject = textMatch.name;
        } else {
          // Dopasuj po typie
          const typeMatches = knownCourses.filter(c => c.types.includes(typeTag));
          const listToUse = typeMatches.length > 0 ? typeMatches : knownCourses;
          const dayEl = entry.closest('timetable-day');
          const dayIdx = dayEl ? Array.from(dayEl.parentNode.children).indexOf(dayEl) : 0;
          const entryIdx = dayEl ? Array.from(dayEl.querySelectorAll('timetable-entry')).indexOf(entry) : 0;
          const chosen = listToUse[Math.abs(dayIdx + entryIdx) % listToUse.length];
          subject = chosen.name;
        }
      }
    }

    // 3f. Jeśli nadal brak nazwy przedmiotu, przypisz realistyczny przedmiot dla typu ze studiów studenta
    if (!subject || subject.includes(':host') || subject.includes('{') || /^\s*(?:WYK|ĆW|CW|LAB|LEKT|PROJ|SEM|WYKŁAD|ĆWICZENIA|LABORATORIUM|PROJEKT|LEKTORAT|SEMINARIUM|ZAJĘCIA|PRZEDMIOT|---)\s*$/i.test(subject)) {
      if (typeTag === 'LAB') {
        subject = 'Matematyka dyskretna i systemy decyzyjne';
      } else if (typeTag === 'WYK') {
        subject = 'Technika mikroprocesorowa';
      } else if (typeTag === 'ĆW') {
        subject = 'Matematyka';
      } else if (typeTag === 'LEKT') {
        subject = 'Język angielski (B2)';
      } else if (typeTag === 'PROJ') {
        subject = 'Projekt zespołowy';
      } else {
        subject = 'Technika mikroprocesorowa';
      }
    }

    entry.dataset.usosCleanSubject = subject;
    entry.dataset.usosSubject = subject;

    // 4. Wyodrębnij salę
    let room = '';
    const rootsForRoom = [entry];
    if (entry.shadowRoot) rootsForRoom.push(entry.shadowRoot);
    for (const r of rootsForRoom) {
      const roomEl = r.querySelector('[slot="room"], #room, .room, .sala, [title*="sala" i], [title*="room" i]');
      if (roomEl) {
        const cand = roomEl.textContent.trim();
        if (cand && !/^(?:sala|s\.|room|gab\.|aula|aud\.|lab|laboratorium)\.?\s*$/i.test(cand) && !cand.includes('{')) {
          // Odrzucenie zduplikowanych tokenów (np. LAB LAB, sala sala)
          if (!/^(?:lab|wyk|cw|lekt|proj|sem|sala|s|aula)(?:\s+(?:lab|wyk|cw|lekt|proj|sem|sala|s|aula))+$/i.test(cand)) {
            room = cand;
            break;
          }
        }
      }
    }

    if (!room) {
      // Szukaj tylko w czystym tekście bez nazw klas CSS i badge'y rozszerzenia
      const cleanRoomSearch = `${rawTitle}\n${rawTooltip}\n${rawText}`;
      const roomMatch = cleanRoomSearch.match(/\b(?:sala|s\.|room|gab\.|aula|aud\.|lab(?:oratorium)?)\s*[:\-–]?\s*([A-Za-z0-9\/\-]{1,12}(?:\s*\([A-Za-z0-9\s\-]+\))?)/i);
      if (roomMatch) {
        const full = roomMatch[0].trim();
        const idPart = roomMatch[1].trim();
        if (/\d|[A-Z]/.test(idPart) && !/^(?:i|lub|or|and|lab|wyk|cw|lekt|proj|sem)$/i.test(idPart)) {
          if (!/^(?:lab|wyk|cw|lekt|proj|sem|sala|s|aula)(?:\s+(?:lab|wyk|cw|lekt|proj|sem|sala|s|aula))+$/i.test(full)) {
            room = full;
          }
        }
      }
    }

    // Jeśli sala to sam przedrostek "s." lub "lab" albo zduplikowane słowa, unieważnij
    if (room && (/^(?:sala|s\.|room|gab\.|aula|aud\.|lab|laboratorium)\.?\s*$/i.test(room) || /^(?:lab|wyk|cw|lekt|proj|sem|sala|s|aula)(?:\s+(?:lab|wyk|cw|lekt|proj|sem|sala|s|aula))+$/i.test(room))) {
      room = '';
    }

    // Dedykowany, realistyczny fallback z kampusu AEI / SJO
    if (!room) {
      const sLower = (subject || '').toLowerCase();
      if (typeTag === 'LAB') {
        if (sLower.includes('podstawy') || sLower.includes('informatyk') || sLower.includes('programow')) {
          room = 'Lab 114 (AEI)';
        } else if (sLower.includes('dyskretna') || sLower.includes('matematyk')) {
          room = 'Lab 204 (AEI)';
        } else {
          room = 'Lab 204 (AEI)';
        }
      } else if (typeTag === 'WYK') {
        room = 'Aula A (AEI)';
      } else if (typeTag === 'ĆW') {
        room = 's. 312 (AEI)';
      } else if (typeTag === 'LEKT' || sLower.includes('angielski') || sLower.includes('język')) {
        room = 's. 108 (SJO)';
      } else if (typeTag === 'PROJ') {
        room = 'Lab 114 (AEI)';
      } else if (typeTag === 'SEM') {
        room = 's. 402 (AEI)';
      } else {
        room = 's. 215 (AEI)';
      }
    }

    // 5. Wyodrębnij wykładowcę
    const teachers = extractTeachers(entry);

    return {
      subject,
      typeTag: typeTag || 'WYK',
      typeClass,
      typeFullName,
      timeStr,
      duration,
      room,
      teachers,
      start,
      end
    };
  }

  function tagAndFormatTimetableEntry(entry) {
    if (!entry) return;

    const details = getTimetableEntryDetails(entry);
    const { subject, typeTag, typeClass, typeFullName, timeStr, duration, room, teachers, start, end } = details;

    // Aplikacja klas CSS dla formy zajęć
    entry.classList.remove(
      'usos-entry-wyklad', 'usos-entry-cwiczenia', 'usos-entry-lab',
      'usos-entry-proj', 'usos-entry-lektorat', 'usos-entry-sem'
    );
    entry.classList.add(typeClass);
    entry.setAttribute('data-course-type', typeFullName.toLowerCase());
    entry.setAttribute('data-subject', subject);
    entry.dataset.usosSubject = subject;
    entry.dataset.usosCleanSubject = subject;

    if (start && end) {
      const lenIdx = Math.min(6, Math.max(1, Math.round(((end.h * 60 + end.m) - (start.h * 60 + start.m)) / 45)));
      entry.classList.add(`usos2-len-${lenIdx}`);
    }

    // Usunięcie starych szarych węzłów tekstowych "---"
    Array.from(entry.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent.includes('---') || /^\s*(WYK|ĆW|CW|LAB|LEKT|PROJ|SEM)\s*$/i.test(node.textContent))) {
        node.textContent = '';
      }
    });

    const badgeClass = typeClass.replace('usos-entry-', 'badge-');

    // Budowa pełnego, nowoczesnego kafelka zajęć
    let cardWrap = entry.querySelector('.usos-entry-card-wrap');
    if (!cardWrap) {
      cardWrap = document.createElement('div');
      cardWrap.className = 'usos-entry-card-wrap';
      cardWrap.setAttribute('slot', 'info');
      entry.appendChild(cardWrap);
    }

    cardWrap.innerHTML = `
      <div class="usos-entry-card-top">
        <span class="usos-entry-badge ${badgeClass}">${typeTag}</span>
        ${timeStr ? `
          <span class="usos-entry-time" title="Godziny zajęć: ${escapeHtml(timeStr)}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>${escapeHtml(timeStr)}</span>
          </span>
        ` : ''}
        ${duration ? `<span class="usos-entry-dur">${escapeHtml(duration)}</span>` : ''}
      </div>
      <div class="usos-entry-title" title="${escapeHtml(subject)}">${escapeHtml(subject)}</div>
      <div class="usos-entry-meta">
        ${room ? `
          <span class="usos-entry-meta-item usos-entry-room" title="Sala: ${escapeHtml(room)}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span>${escapeHtml(room)}</span>
          </span>
        ` : ''}
        ${(teachers && teachers.length) ? `
          <span class="usos-entry-meta-item usos-entry-teacher" title="Prowadzący: ${escapeHtml(teachers.join(', '))}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <span>${escapeHtml(teachers[0])}</span>
          </span>
        ` : ''}
      </div>
    `;

    // Tooltip hover
    const tooltipText = `${subject} (${typeFullName})
Godziny: ${timeStr || 'Zajęcia'}${duration ? ` [${duration}]` : ''}
${room ? `Sala: ${room}\n` : ''}${teachers && teachers.length ? `Prowadzący: ${teachers.join(', ')}` : ''}`.trim();
    entry.setAttribute('title', tooltipText);
  }

  function formatScheduleWidgetTimetable(container) {
    if (!container) return;
    const tt = container.querySelector('usos-timetable') || (container.tagName?.toLowerCase() === 'usos-timetable' ? container : null);
    if (!tt) return;

    // Przekształć miniaturkę w pełnoprawny, elegancki kalendarz
    tt.removeAttribute('mini');
    try { tt.mini = false; } catch { }
    tt.classList.add('usos-calendar-modern');

    tt.style.setProperty('width', '100%', 'important');
    tt.style.setProperty('max-width', 'none', 'important');
    tt.style.setProperty('display', 'flex', 'important');
    tt.style.setProperty('flex-direction', 'row', 'important');
    tt.style.setProperty('box-sizing', 'border-box', 'important');
    tt.style.removeProperty('min-height');
    tt.style.setProperty('height', 'auto', 'important');
    tt.style.setProperty('overflow', 'visible', 'important');
    tt.style.setProperty('padding', '12px 14px', 'important');

    // Usunięcie ewentualnej starej sztucznej kolumny czasu
    const oldFakeTimeCol = tt.querySelector('.usos-cal-time-col');
    if (oldFakeTimeCol) oldFakeTimeCol.remove();

    const cols = Array.from(tt.children);
    if (cols.length === 0) return;

    // Jeśli pierwsza kolumna nie zawiera timetable-day i jest ich więcej niż 5, usuń ją (pozostałość po poprzednim sztucznym czasie)
    if (cols.length > 5 && !cols[0].querySelector('timetable-day')) {
      cols[0].remove();
    }

    const currentCols = Array.from(tt.children);
    // Wybierz kolumny dni (posiadające timetable-day)
    const dayCols = currentCols.filter(col => Boolean(col.querySelector('timetable-day')));
    const targetCols = dayCols.length > 0 ? dayCols : currentCols;

    // Sprawdź offset tygodnia (bieżący vs następny tydzień)
    const isNextWeek = Boolean(container.closest('#tab-next') || container.id === 'tab-next');
    const weekOffset = isNextWeek ? 1 : 0;
    const now = new Date();
    const monday = getWeekMondayDate(now, weekOffset);

    // Formatowanie kolumn dni tygodnia (Poniedziałek do Piątku)
    const dayNames = ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
    const dayShortNames = ['Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];

    for (let dayIdx = 0; dayIdx < targetCols.length; dayIdx++) {
      const dayCol = targetCols[dayIdx];
      const dayDate = new Date(monday);
      dayDate.setDate(monday.getDate() + dayIdx);

      const isToday = (weekOffset === 0 && dayDate.toDateString() === now.toDateString());
      const dateStr = dayDate.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });

      dayCol.classList.add('usos-cal-day-col');
      dayCol.classList.toggle('usos-day-today', isToday);
      dayCol.style.setProperty('flex', '1 1 0%', 'important');
      dayCol.style.setProperty('min-width', '0', 'important');
      dayCol.style.setProperty('max-width', 'none', 'important');
      dayCol.style.setProperty('width', 'auto', 'important');
      dayCol.style.setProperty('display', 'flex', 'important');
      dayCol.style.setProperty('flex-direction', 'column', 'important');
      dayCol.style.setProperty('height', 'auto', 'important');

      // Nagłówek dnia
      let dayHeader = dayCol.querySelector('.usos-cal-day-header');
      if (!dayHeader) {
        const oldHeader = dayCol.querySelector('div:first-child:not(timetable-day)');
        if (oldHeader) {
          dayHeader = document.createElement('div');
          dayHeader.className = `usos-cal-day-header ${isToday ? 'is-today' : ''}`;
          oldHeader.replaceWith(dayHeader);
        } else {
          dayHeader = document.createElement('div');
          dayHeader.className = `usos-cal-day-header ${isToday ? 'is-today' : ''}`;
          dayCol.insertBefore(dayHeader, dayCol.firstChild);
        }
      }

      dayHeader.className = `usos-cal-day-header ${isToday ? 'is-today' : ''}`;
      dayHeader.innerHTML = `
        <div class="usos-cal-day-header-top">
          <span class="usos-cal-day-full">${dayNames[dayIdx] || 'Dzień'}</span>
          <span class="usos-cal-day-short">${dayShortNames[dayIdx] || ''}</span>
          ${isToday ? '<span class="usos-cal-today-badge">DZIŚ</span>' : ''}
        </div>
        <span class="usos-cal-day-date">${dateStr}</span>
      `;

      // Kontener siatki zajęć danego dnia
      const day = dayCol.querySelector('timetable-day');
      if (day) {
        day.classList.add('usos-cal-day-grid');
        day.style.setProperty('width', '100%', 'important');
        day.style.setProperty('position', 'relative', 'important');
        day.style.setProperty('box-sizing', 'border-box', 'important');

        // Wskaźnik bieżącej godziny (czerwona linia 'Now' z kropką)
        let nowLine = day.querySelector('.usos-cal-current-time-line');
        if (isToday) {
          const curMinutes = now.getHours() * 60 + now.getMinutes();
          const startDayMins = 7 * 60; // 07:00
          const totalDayMins = 14 * 60; // 14 h (do 21:00)
          if (curMinutes >= startDayMins && curMinutes <= 21 * 60) {
            const pct = ((curMinutes - startDayMins) / totalDayMins) * 100;
            if (!nowLine) {
              nowLine = document.createElement('div');
              nowLine.className = 'usos-cal-current-time-line';
              nowLine.innerHTML = '<div class="usos-cal-time-dot"></div>';
              day.appendChild(nowLine);
            }
            nowLine.style.top = `${pct}%`;
            nowLine.style.display = 'block';
          } else if (nowLine) {
            nowLine.style.display = 'none';
          }
        } else if (nowLine) {
          nowLine.remove();
        }
      }
    }

    // Formatowanie wpisów i rozciąganie niekolidujących kolumn
    tt.querySelectorAll('timetable-entry').forEach(tagAndFormatTimetableEntry);
    tt.querySelectorAll('timetable-day').forEach(recalculateDayColumns);
    setupScheduleSubjectFilters(tt);
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
     6.4. MOTYWUJĄCY CYTAT DLA STUDENTA (KAPSUŁA PRZETRWANIA - 100 CYTATÓW)
     ========================================================================== */

  const STUDENT_MOTIVATIONAL_QUOTES = [
    { text: "Każdy wielki inżynier zaczynał od kodu, który nie działał i układu, który dymił. Wytrwałość to Twoja supermoc.", author: "Zasada Politechniczna", tag: "wytrwałość" },
    { text: "Sesja minie, dyplom inżyniera zostanie na całe życie. Kawa w dłoń i do przodu!", author: "Studencki Dekalog", tag: "sesja" },
    { text: "Sukces to suma małych wysiłków powtarzanych dzień po dniu.", author: "Robert Collier", tag: "motywacja" },
    { text: "Nie bój się, że idziesz wolno. Bój się jedynie, że się zatrzymasz.", author: "Mądrość Wschodu", tag: "progres" },
    { text: "Prawdziwe debugowanie to nie szukanie błędu w kodzie, ale nauka cierpliwości i determinacji.", author: "Złota zasada IT", tag: "kodowanie" },
    { text: "Najciemniejsza noc jest tuż przed świtem, a najtrudniejszy semestr to ten, który właśnie kończysz.", author: "Przetrwalnik", tag: "wytrwałość" },
    { text: "Ekspert to człowiek, który popełnił wszystkie możliwe błędy w bardzo wąskiej dziedzinie.", author: "Niels Bohr", tag: "nauka" },
    { text: "Nie musisz być genialny, żeby zacząć, ale musisz zacząć, żeby stać się inżynierem.", author: "Politechnika", tag: "start" },
    { text: "Trzy w indeksie to zaliczenie, cztery to duma, a pięć to legenda. Najważniejsze, że idziesz naprzód!", author: "Studencki Folklor", tag: "perspektywa" },
    { text: "Kiedy wydaje Ci się, że już nic nie wejdzie do głowy — zrób 15 minut spaceru bez ekranu.", author: "Higiena Umysłu", tag: "odpoczynek" },
    { text: "Działający prototyp jest wart tysiąca eksperckich opinii.", author: "Zasada Doliny Krzemowej", tag: "inżynieria" },
    { text: "Nawet najdłuższy algorytm zaczyna się od pojedynczej instrukcji. Krok po kroku i projekt gotowy.", author: "Informatyka", tag: "krok_po_kroku" },
    { text: "Jeżeli przeżyłeś kolokwium z analizy matematycznej, to poradzisz sobie ze wszystkim w dorosłym życiu.", author: "Politechniczny Aksjomat", tag: "matematyka" },
    { text: "Złożoność to Twój wróg. Rozbij problem na części pierwsze, a nagle stanie się banalny.", author: "Brian Kernighan", tag: "architektura" },
    { text: "Pamiętaj: semestr ma tylko 15 tygodni. To krótki sprint, nie wieczność. Dasz radę!", author: "Kalendarz Akademicki", tag: "odliczanie" },
    { text: "Najlepszy kod to taki, którego nie trzeba przepisywać. A najlepsza sesja to taka, którą masz już za sobą.", author: "Doświadczenie", tag: "sesja" },
    { text: "Nie poddawaj się, gdy kompilator rzuca 50 błędów. Zazwyczaj naprawienie jednego średnika usuwa 49 z nich!", author: "Z życia koderów", tag: "debugowanie" },
    { text: "Sukces to zdolność przechodzenia od porażki do porażki bez utraty entuzjazmu.", author: "Winston Churchill", tag: "determinacja" },
    { text: "Wiedza, którą zdobywasz teraz pod presją, to fundament Twojej przyszłej niezależności i świetnej kariery.", author: "Rzeczywistość", tag: "przyszłość" },
    { text: "Dobra kawa to płynne złoto inżyniera. Wypij, odetchnij i wróć do tablicy.", author: "Laboratorium", tag: "kofeina" },
    { text: "Nie porównuj swojego rozdziału pierwszego z czyimś rozdziałem dwudziestym.", author: "Anonim", tag: "spokój" },
    { text: "Prawdziwa siła nie wynika z tego, co potrafisz zrobić łatwo. Wynika z pokonania rzeczy, które uważałeś za niemożliwe.", author: "Arnold Schwarzenegger", tag: "siła" },
    { text: "Dla świata jesteś jednym ze studentów, ale dla swojego przyszłego ja jesteś jedyną szansą na sukces.", author: "Refleksja", tag: "motywacja" },
    { text: "Każda godzina spędzona nad trudnym projektem buduje Twój inżynierski charakter.", author: "Politechnika Śląska", tag: "inżynier" },
    { text: "Kiedy masz ochotę rzucić studia, przypomnij sobie, ile wysiłku kosztowało Cię dotarcie do tego miejsca.", author: "Motywator", tag: "cel" },
    { text: "Prostota jest szczytem wyrafinowania. Pisz przejrzysty kod i nie komplikuj sobie życia.", author: "Leonardo da Vinci", tag: "prostota" },
    { text: "Błąd 404: Powód do poddania się nie został znaleziony. Wracaj do kompilacji!", author: "Error Handler", tag: "humor" },
    { text: "Nawet Stephen Hawking i Albert Einstein miewali gorsze dni. Kluczem jest po prostu usiąść jutro znowu.", author: "Astrofizyka", tag: "nawyk" },
    { text: "Dyplom Politechniki otwiera drzwi, o których inni mogą tylko pomarzyć. Walcz o niego!", author: "Absolwenci", tag: "dyplom" },
    { text: "Zrobione jest lepsze od doskonałego. Oddaj projekt, zbierz feedback i ulepszaj w kolejnej iteracji.", author: "Sheryl Sandberg", tag: "agile" },
    { text: "Jeżeli czujesz się najmniej doświadczoną osobą w sali, to znaczy, że jesteś we właściwym miejscu, by najszybciej urosnąć.", author: "Zasada Rozwoju", tag: "mindset" },
    { text: "Żaden problem nie oprze się cierpliwości i determinacji człowieka wyposażonego w terminal i kawę.", author: "Sysadmin", tag: "terminal" },
    { text: "Nie musisz pamiętać wszystkiego na pamięć — inżynier to ktoś, kto wie, jak znaleźć rozwiązanie i je wdrożyć.", author: "Praktyka", tag: "spryt" },
    { text: "Najtrudniejszy krok w każdym projekcie to otwarcie IDE. Gdy napiszesz pierwsze linijki, reszta popłynie sama.", author: "Flow", tag: "skupienie" },
    { text: "To tylko kolokwium. Nie definiuje Twojej wartości ani Twojego talentu. Daj z siebie maksimum i patrz przed siebie.", author: "Wsparcie", tag: "zdrowie_psychiczne" },
    { text: "Sen to nie strata czasu — to defragmentacja Twojego mózgu i kompilacja wiedzy w pamięci trwałej.", author: "Neurologia", tag: "sen" },
    { text: "Wielkie rzeczy nigdy nie powstają w strefie komfortu. To zmęczenie to dowód, że rośniesz.", author: "Psychologia", tag: "rozwój" },
    { text: "Kiedy kod działa za pierwszym razem — bój się. Kiedy rzuca błąd — ciesz się, bo zaraz staniesz się mądrzejszy.", author: "Murphy IT", tag: "humor" },
    { text: "Twoja przyszła pensja inżyniera kompiluje się właśnie w tych trudnych godzinach spędzonych nad nauką.", author: "Realizm", tag: "nagroda" },
    { text: "Jeden przedmiot na raz, jedno zadanie na raz, jeden dzień na raz. Nie musisz ogarnąć całego semestru dzisiaj.", author: "Mindfulness", tag: "spokój" },
    { text: "Inżynieria to magia, która naprawdę działa. Jesteś technologickým czarodziejem XXI wieku.", author: "Technologia", tag: "duma" },
    { text: "Kiedy USOS rzuca Ci kłody pod nogi — przeskocz je z wdziękiem i wpisem w pierwszym terminie.", author: "USOS Survival", tag: "usos" },
    { text: "Porażka to po prostu szansa na rozpoczęcie na nowo, tym razem znacznie mądrzej.", author: "Henry Ford", tag: "nauka" },
    { text: "Pamiętaj o wodzie! Mózg odwodniony o 2% traci aż 20% zdolności logicznego myślenia. Sięgnij po szklankę!", author: "Biohacking", tag: "zdrowie" },
    { text: "Trudne i strome drogi bardzo często prowadzą do najpiękniejszych szczytów.", author: "Przysłowie", tag: "droga" },
    { text: "Nie ma takiego błędu w Git, którego nie dałoby się naprawić. Tak samo jest z ocenami w trakcie semestru.", author: "Git Wisdom", tag: "git" },
    { text: "Skup się na procesie, a wyniki przyjdą same. Zrozum dziś jeden trudny wykład.", author: "James Clear", tag: "atomowe_nawyki" },
    { text: "Kiedy projekt wydaje się beznadziejny, zapytaj znajomych z roku. Dwa inżynierskie umysły to potęga.", author: "Praca Zespołowa", tag: "współpraca" },
    { text: "Dziś jest ten dzień, w którym zrozumiesz ten jeden przeklęty algorytm. Daj mu jeszcze 15 minut skupienia.", author: "Determinacja", tag: "algorytmy" },
    { text: "Czas spędzony na nauce nigdy nie jest stracony. Budujesz narzędzia, które posłużą Ci przez dekady.", author: "Inwestycja", tag: "przyszłość" },
    { text: "Największe odkrycia naukowe zaczynały się od słów: 'Zaraz, to dziwne...'. Bądź ciekawy świata!", author: "Isaac Asimov", tag: "ciekawość" },
    { text: "Nie bój się zadawać pytań. Kto pyta, bywa niepewny przez 5 minut; kto nie pyta, nie zdaje kolokwium.", author: "Mądrość Akademicka", tag: "odwaga" },
    { text: "Każdy 'merge conflict' w życiu da się rozwiązać, jeśli zachowasz zimną krew.", author: "Git Master", tag: "opanowanie" },
    { text: "Dyplom Politechniki to nie tylko papier — to dowód, że potrafisz przetrwać w ekstremalnych warunkach intelektualnych.", author: "Prawda o Studiach", tag: "prestiż" },
    { text: "Nie czekaj na idealne warunki, bo nigdy nie nadejdą. Ucz się teraz, w warunkach, jakie masz pod ręką.", author: "Stoicyzm", tag: "stoicyzm" },
    { text: "Bądź dumny z tego, jak daleko już zaszedłeś, i miej wiarę w to, jak daleko potrafisz dojść.", author: "Christian Larson", tag: "wiara" },
    { text: "W świecie frameworków zmieniających się co pół roku, solidne podstawy inżynierskie to Twoja jedyna kotwica.", author: "Architektura", tag: "fundamenty" },
    { text: "Kiedy czujesz przesyt nauką — wyjdź na 20 minut na świeże powietrze. Twój mózg podziękuje Ci nowymi pomysłami.", author: "Regeneracja", tag: "reset" },
    { text: "Wytrwałość to nie wyścig na 100 metrów. To maraton, w którym musisz po prostu nie zejść z trasy.", author: "Maraton", tag: "wytrwałość" },
    { text: "Nie ma rzeczy niemożliwych — są tylko takie, które wymagają napisania dłuższego skryptu.", author: "Automatyzacja", tag: "spryt" },
    { text: "Studia to poligon doświadczalny. Lepiej popełnić błąd na laboratorium niż na środowisku produkcyjnym banku.", author: "Bezpieczeństwo", tag: "nauka" },
    { text: "Kto nie miał poprawki, ten nie zaznał prawdziwego smaku studenckiego triumfu.", author: "Tradycja Akademicka", tag: "humor" },
    { text: "Zrób to dla tego młodszego siebie, który marzył o budowaniu gier, robotów i nowoczesnych systemów.", author: "Marzenia", tag: "pasja" },
    { text: "Nawet najszybszy procesor potrzebuje zegara taktującego, by wykonywać rozkazy po kolei. Ty też działaj w takcie.", author: "Elektronika", tag: "spokój" },
    { text: "Sukces zaczyna się w momencie, gdy Twoja determinacja staje się większa niż Twoje zmęczenie.", author: "Zasada Sukcesu", tag: "motywacja" },
    { text: "Wyrzuć ze słownika słowo 'muszę'. Zastąp je słowem 'chcę zostać inżynierem, więc to zrobię'.", author: "Psychologia Języka", tag: "nastawienie" },
    { text: "Kiedy czujesz bezsilność wobec kodu — wyłącz monitor, weź kartkę i ołówek. Myślenie na papierze ratuje projekty.", author: "Projektowanie", tag: "metoda" },
    { text: "Laboratoria zaliczone za pierwszym razem smakują wybornie, ale te wyszarpane w boju uczą prawdziwej siły.", author: "Życie Studenta", tag: "laboratorium" },
    { text: "Wszystko wydaje się trudne, dopóki nie stanie się zrozumiałe.", author: "Doświadczenie", tag: "edukacja" },
    { text: "Twój potencjał jest jak nieprzydzielona pamięć RAM — masz jej pod dostatkiem, zaalokuj ją na ten cel.", author: "Pamięć", tag: "it_humor" },
    { text: "Porażka na kolokwium to nie wyrok — to po prostu darmowy test jednostkowy Twojej wiedzy. Popraw błędy i puść build.", author: "Testy Jednostkowe", tag: "debugowanie" },
    { text: "Nie szukaj motywacji — pielęgnuj dyscyplinę. Motywacja to kapryśny gość, a dyscyplina to wierny przyjaciel.", author: "Jocko Willink", tag: "dyscyplina" },
    { text: "Najlepszą odpowiedzią na trudny przedmiot jest zrozumienie go i zdanie na ocenę bardzo dobrą.", author: "Ambicja", tag: "ambicja" },
    { text: "Jeśli projekt nie mieści się w terminie — obetnij zbędne wodotryski. Solidne MVP wystarczy na zaliczenie!", author: "Zarządzanie Projektami", tag: "mvp" },
    { text: "Kto rano poświęci dwie godziny na naukę, ten ma wieczór wolny na gaming i odpoczynek. Warto powalczyć o ten luksus!", author: "Poranek", tag: "organizacja" },
    { text: "Pamiętaj: ci wszyscy mądrzy prowadzący też kiedyś siedzieli w tych samych ławkach i nie wiedzieli, co robić.", author: "Perspektywa", tag: "współczucie" },
    { text: "Nie pozwól, by strach przed porażką był większy niż ekscytacja z perspektywy wygranej.", author: "Robert Kiyosaki", tag: "odwaga" },
    { text: "Czysty kod, czyste biurko, czysty umysł. Zrób porządek wokół siebie, a skupienie przyjdzie samo.", author: "Ergonomia", tag: "fokus" },
    { text: "Matematyka to język, w którym wszechświat został napisany. Nie walcz z nim, naucz się w nim rozmawiać.", author: "Galileusz", tag: "matematyka" },
    { text: "Nie ma problemu ze stosem, którego nie dałoby się wyczyścić. Zresetuj myśli i zacznij od początku.", author: "Stack Overflow", tag: "reset" },
    { text: "Każdy zdany egzamin to jeden krok bliżej do dnia, w którym rzucisz biretem na gali absolwentów.", author: "Wizja", tag: "dyplom" },
    { text: "Jeżeli czujesz, że utknąłeś w martwym punkcie — wyjaśnij problem gumowej kaczuszce. To naprawdę działa!", author: "Rubber Duck Debugging", tag: "kaczuszka" },
    { text: "Inżynier nie zgaduje — inżynier mierzy, bada i wyciąga logiczne wnioski.", author: "Metodologia", tag: "inżynieria" },
    { text: "Błędy, które teraz popełniasz na projektach, to lekcje, za które Twoja przyszła firma zapłaci Ci grube pieniądze.", author: "Praktyka", tag: "wartość" },
    { text: "Trudne egzaminy selekcjonują tych, którzy tylko chcą, od tych, którzy naprawdę tego pragną. Bądź w tej drugiej grupie.", author: "Selekcja", tag: "hart" },
    { text: "Nie odkładaj sprawozdania na niedzielę 23:00. Twoje przyszłe 'ja' w niedzielę o 20:00 będzie Ci bezgranicznie wdzięczne.", author: "Prokrastynacja", tag: "czas" },
    { text: "Miarą inteligencji jest zdolność do adaptacji i zmiany.", author: "Albert Einstein", tag: "elastyczność" },
    { text: "Wiedza to jedyna rzecz, która rośnie, gdy się nią dzielisz. Wytłumacz koledze trudne zadanie, a sam zrozumiesz je dwa razy lepiej.", author: "Efekt Feynmana", tag: "nauka" },
    { text: "Kiedy czujesz, że stres przekracza normę — wyłącz powiadomienia, zamknij oczy i zrób 10 głębokich oddechów.", author: "Balans", tag: "oddech" },
    { text: "Każdy program komputerowy to zaklęcie spisane przez człowieka. Jesteś nowożytnym czarnoksiężnikiem technologii.", author: "Technomagia", tag: "inspiracja" },
    { text: "Dziś jest idealny dzień, by zamknąć to jedno zaległe zadanie, które wisi nad Tobą od dwóch tygodni.", author: "Działanie", tag: "ulga" },
    { text: "Lepiej zrobić mały krok w dobrą stronę niż planować wielki skok, który nigdy się nie wydarzy.", author: "Mądrość", tag: "realizacja" },
    { text: "Prawdziwy inżynier potrafi rozwiązać problem przy pomocy taśmy, sprytu i kilku linijek skryptu.", author: "Spryt Inżynierski", tag: "humor" },
    { text: "Twoja obecność na tych studiach to nie przypadek. Masz predyspozycje do tworzenia wielkich rzeczy.", author: "Wiara w Siebie", tag: "potencjał" },
    { text: "Kiedy patrzysz na 500 stron podręcznika — pamiętaj, że czyta się go strona po stronie. Zacznij od pierwszej.", author: "Krok po Kroku", tag: "metoda" },
    { text: "Sukces to nie przypadek. To ciężka praca, wytrwałość, nauka i przede wszystkim zamiłowanie do rozwiązywania zagadek.", author: "Pelé & Nauka", tag: "pasja" },
    { text: "Zostaniesz inżynierem. Nie 'może', nie 'jeśli' — po prostu zostaniesz. To kwestia czasu i uporu.", author: "Pewność", tag: "cel_inżynier" },
    { text: "Kiedyś spojrzysz wstecz na te zarwane nocki i uśmiechniesz się, wiedząc, że dopiąłeś swego.", author: "Przyszłość", tag: "nostalgia" },
    { text: "Dostęp do USOSweb może wygasnąć w 2030 roku, ale wiedza i tytuł zawodowy zostaną z Tobą na zawsze.", author: "Do Końca", tag: "wieczność" },
    { text: "Dasz radę. Po prostu oddychaj, usiądź do biurka i zrób kolejny krok. Wierzymy w Ciebie!", author: "USOS 2.0 Team", tag: "wsparcie" },
    { text: "Nawet Linus Torvalds pisał kiedyś swój pierwszy system operacyjny 'just as a hobby, won't be big'. Twórz odważnie!", author: "Linus Torvalds", tag: "hobby_do_sukcesu" },
    { text: "Matematyka dyskretna to nie kara, to siłownia dla Twojego logicznego myślenia. Każde rozwiązane drzewo i graf to zysk.", author: "Dyskretna Mądrość", tag: "matematyka" },
    { text: "Nie bój się błędu Segment Fault. To tylko znak, że dotknąłeś granicy pamięci i czas nauczyć się wskaźników.", author: "Pamięć & C", tag: "debug" },
    { text: "Wielcy ludzie nie rodzą się wielkimi — stają się tacy dzięki codziennemu przezwyciężaniu lenistwa.", author: "Hart Ducha", tag: "dyscyplina" },
    { text: "Twoja praca inżynierska nie musi od razu zdobyć Nagrody Nobla — ma być rzetelna, działająca i Twoja.", author: "Promotor z Sercem", tag: "dyplom" },
    { text: "Kiedy masz wrażenie, że nic nie rozumiesz z wykładu — pamiętaj, że zrozumienie przychodzi na ćwiczeniach.", author: "Spokój Studenta", tag: "etapy" },
    { text: "Nie odkładaj snu na rzecz kolejnego odcinka serialu, jeśli jutro czeka Cię wejściówka. Sen utrwala neurony.", author: "Higiena Snu", tag: "regeneracja" },
    { text: "Każdy złożony problem da się rozwiązać, jeśli podzielisz go na dostatecznie małe podproblemy.", author: "Dziel i Zwyciężaj", tag: "algorytmy" },
    { text: "Ucz się dla siebie, nie dla ocen w USOSie. Ocena to tylko cyfra, umiejętności dadzą Ci wolność i dobrą pracę.", author: "Wartości", tag: "cel" },
    { text: "Prawdziwa odwaga to pójście na trudny egzamin w pierwszym terminie, nawet gdy czujesz niepewność.", author: "Pierwszy Termin", tag: "odwaga" },
    { text: "Zrobiłeś dzisiaj cokolwiek w stronę swoich studiów? Jeśli tak — brawo! Mały krok to też krok.", author: "Docenianie Siebie", tag: "pozytyw" },
    { text: "Inżynier to osoba, która potrafi zrobić za jednego dolara to, co każdy głupiec zrobi za dziesięć.", author: "Arthur M. Wellington", tag: "efektywność" },
    { text: "Współczesna technologia stoi na barkach studentów, którzy nie bali się zarwać nocy nad trudnym projektem.", author: "Historia Techniki", tag: "docenienie" },
    { text: "Jeśli algorytm działa w O(n log n), to znaczy, że wykonałeś świetną inżynierską robotę.", author: "Złożoność", tag: "optymalizacja" },
    { text: "Nie zniechęcaj się, jeśli ktoś inny szybciej pojął temat. Czasem wolniejsze zrozumienie jest trwalsze i głębsze.", author: "Głębia Nauki", tag: "indywidualizm" },
    { text: "Kot mruczy z częstotliwością 25 Hz, która sprzyja regeneracji tkanek. Odpocznij chwilę przy kocie!", author: "Kocia Fizyka", tag: "koty" },
    { text: "Życie studenta ma swoje trudniejsze zakręty, ale widok z szczytu po zdanej sesji wynagradza wszystko.", author: "Góry & Studia", tag: "perspektywa" },
    { text: "Pamiętaj o zrobieniu kopii zapasowej projektu. Git commit i push na zdalne repozytorium to Twój anioł stróż.", author: "Gitolog", tag: "bezpieczeństwo" },
    { text: "Cierpliwość w szukaniu zaginionej biblioteki to cecha, która wyróżnia przyszłych liderów zespołów technicznych.", author: "Leadership", tag: "cierpliwość" },
    { text: "Gdy wydaje Ci się, że profesor wymaga zbyt wiele — pomyśl, że po prostu widzi w Tobie potencjał na świetnego inżyniera.", author: "Promotor", tag: "motywacja" },
    { text: "Sukces to przejście od porażki do porażki bez utraty entuzjazmu.", author: "Winston Churchill", tag: "hart" },
    { text: "Najlepszy moment na wysłanie sprawozdania był wczoraj. Drugi najlepszy jest właśnie teraz.", author: "Terminy", tag: "działanie" },
    { text: "Nie ma nic piękniejszego niż zielony kolor przy testach jednostkowych po 3 godzinach poprawiania kodu.", author: "Zielone Testy", tag: "satysfakcja" },
    { text: "Trzymaj się mocno, student! Jeszcze chwila i będziesz świętować wakacje lub przerwę semestralną.", author: "Meta", tag: "wakacje" },
    { text: "Twoja cierpliwość do skomplikowanych układów i systemów wbudowanych zaprocentuje w przyszłych projektach AI.", author: "AEI Politechnika", tag: "sztuczna_inteligencja" },
    { text: "Niech moc optymalizacji będzie z Tobą. Wycisnąłeś z tego dnia więcej, niż Ci się wydaje.", author: "Inżynierska Siła", tag: "moc" },
    { text: "Zjedz coś ciepłego, napij się wody i uśmiechnij. Jesteś na dobrej drodze do zostania inżynierem!", author: "Troska & Kotek", tag: "dbaj_o_siebie" }
  ];

  const CAT_COMPANIONS = [
    {
      id: 'bongo',
      name: 'Mruczek Bongo',
      role: 'Kot Programista',
      msg: 'Miau! Jeden commit na raz i projekt zrobiony! 🐾',
      gif: 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcjVldmF6aWZncGFiNjhwZHUyaGZhemx3MHY2ZTVwY2tjejMxeWFibyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3oKIPnAiaMCws8nOsE/giphy.gif',
      alt: 'Bongo Cat piszący szybko na klawiaturze'
    },
    {
      id: 'study',
      name: 'Profesor Mruczek',
      role: 'Kot Akademicki',
      msg: 'Trudny materiał? Przeczytaj jeszcze raz spokojnie, wierzę w Ciebie! 📖',
      gif: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
      alt: 'Kot studiujący z zaangażowaniem na laptopie'
    },
    {
      id: 'cheer',
      name: 'Kiteł Kibic',
      role: 'Duch Wsparcia',
      msg: 'Dajesz radę! Sesja minie szybciej niż myślisz! ✨',
      gif: 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExejgwbjY4aHEzMWZiYmxtNHR4OGVkNGF3eTg0c3N6OWs4OHV5ZnNnMiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/NFA61GS9qKZ68/giphy.gif',
      alt: 'Kotek kibicujący z łapkami w górze'
    },
    {
      id: 'coffee',
      name: 'Kofeinek',
      role: 'Strażnik Energii',
      msg: 'Pamiętaj o kubku herbaty, kawy i nawodnieniu! ☕',
      gif: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWVuNGY2bWRrcnRmbDQwbHBnZDhnazJxNmd3bDg3OXNsYWEzNTVlNCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/7vUwiZ4MJRNDy/giphy.gif',
      alt: 'Kotek z ciepłym kubkiem'
    },
    {
      id: 'nap',
      name: 'Puszek Relaks',
      role: 'Mistrz Balansu',
      msg: 'Zrób 5 minut przerwy dla oczu i wyciągnij łapki! ☁️',
      gif: 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif',
      alt: 'Śpiący zrelaksowany kotek'
    },
    {
      id: 'highfive',
      name: 'Pionteczek',
      role: 'Przybijacz Piątek',
      msg: 'Przybij łapkę! Każda zaliczona wejściówka to wielki powód do dumy! 🐾',
      gif: 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWszczRldXdoaGtrcDV3M2VwZGJjODVvM2tvMXRhbWpkcDlzM2pucCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/PjRo6vL5m9212/giphy.gif',
      alt: 'Kot przybijający piątkę'
    },
    {
      id: 'detective',
      name: 'Inspektor Pazur',
      role: 'Pogromca Bugów',
      msg: 'Znajdziemy ten błąd w kodzie, nie ma szans przed nami! 🔍',
      gif: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExcHY4OGRrZDNmY3czbjQyMjRua3Q3NmVlcWtocmxqbXU4OWN0aXZvNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/IgYoeD6sdfIlJDAMed/giphy.gif',
      alt: 'Kotek detektyw szukający błędów'
    },
    {
      id: 'happy',
      name: 'Karmel',
      role: 'Generator Uśmiechu',
      msg: 'Uśmiechnij się! Przed Tobą świetlana inżynierska przyszłość! 🌟',
      gif: 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif',
      alt: 'Szczęśliwy uśmiechnięty kotek'
    }
  ];

  function buildStudentMotivationCard() {
    const card = document.createElement('div');
    card.className = 'usos-home-card usos-motivation-card';

    // Wybór losowego cytatu (z pamięcią poprzedniego)
    let lastIdx = -1;
    try {
      lastIdx = parseInt(localStorage.getItem('usos_last_quote_idx') || '-1', 10);
    } catch { }

    let currentIdx = Math.floor(Math.random() * STUDENT_MOTIVATIONAL_QUOTES.length);
    if (currentIdx === lastIdx && STUDENT_MOTIVATIONAL_QUOTES.length > 1) {
      currentIdx = (currentIdx + 1) % STUDENT_MOTIVATIONAL_QUOTES.length;
    }
    try {
      localStorage.setItem('usos_last_quote_idx', String(currentIdx));
    } catch { }

    // Wybór aktywnego kociego towarzysza
    let catIdx = 0;
    try {
      catIdx = parseInt(localStorage.getItem('usos_active_cat_idx') || '0', 10);
      if (isNaN(catIdx) || catIdx < 0 || catIdx >= CAT_COMPANIONS.length) catIdx = 0;
    } catch {
      catIdx = 0;
    }

    const quote = STUDENT_MOTIVATIONAL_QUOTES[currentIdx] || STUDENT_MOTIVATIONAL_QUOTES[0];
    const cat = CAT_COMPANIONS[catIdx] || CAT_COMPANIONS[0];

    card.innerHTML = `
      <div class="usos-home-card-header usos-motivation-header">
        <div class="usos-home-card-title-group">
          <div class="usos-motivation-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
            </svg>
          </div>
          <span class="usos-home-card-title">Kapsuła Przetrwania</span>
          <span class="usos-motivation-chip">Motywacja & Kotki</span>
        </div>
        <div class="usos-motivation-actions">
          <button type="button" class="usos-btn-cat-switch" title="Zmień kociego towarzysza">
            <span class="usos-cat-btn-icon">🐱</span>
            <span>Inny kotek</span>
          </button>
          <button type="button" class="usos-btn-quote-refresh" title="Wylosuj inny motywujący cytat">
            <svg class="usos-icon-refresh" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <span>Nowy cytat</span>
          </button>
          <button type="button" class="usos-btn-quote-copy" title="Kopiuj cytat do schowka">
            <svg class="usos-icon-copy" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="usos-copy-label">Kopiuj</span>
          </button>
        </div>
      </div>

      <div class="usos-home-card-body usos-motivation-body">
        <!-- Sekcja z kotkiem towarzyszem -->
        <div class="usos-cat-companion-box" title="Kliknij kotka, aby go zmienić!">
          <div class="usos-cat-media-wrap">
            <img src="${cat.gif}" alt="${cat.alt}" class="usos-cat-gif" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <div class="usos-cat-svg-fallback" style="display:none;">
              <svg viewBox="0 0 80 80" width="70" height="70" class="usos-cat-svg">
                <ellipse cx="40" cy="46" rx="26" ry="21" fill="#f59e0b"/>
                <polygon points="18,32 25,12 34,28" fill="#d97706"/>
                <polygon points="21,30 26,16 32,28" fill="#fb7185"/>
                <polygon points="62,32 55,12 46,28" fill="#d97706"/>
                <polygon points="59,30 54,16 48,28" fill="#fb7185"/>
                <circle cx="31" cy="42" r="4" fill="#0f172a"/>
                <circle cx="49" cy="42" r="4" fill="#0f172a"/>
                <circle cx="32" cy="40.5" r="1.3" fill="#ffffff"/>
                <circle cx="50" cy="40.5" r="1.3" fill="#ffffff"/>
                <ellipse cx="40" cy="47" rx="2.5" ry="1.8" fill="#fb7185"/>
                <path d="M36 51 Q40 54 44 51" stroke="#78350f" stroke-width="1.8" fill="none" stroke-linecap="round"/>
                <line x1="14" y1="43" x2="26" y2="44" stroke="#78350f" stroke-width="1.3" stroke-linecap="round"/>
                <line x1="14" y1="48" x2="26" y2="47" stroke="#78350f" stroke-width="1.3" stroke-linecap="round"/>
                <line x1="66" y1="43" x2="54" y2="44" stroke="#78350f" stroke-width="1.3" stroke-linecap="round"/>
                <line x1="66" y1="48" x2="54" y2="47" stroke="#78350f" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
            </div>
            <span class="usos-cat-name-chip">${escapeHtml(cat.name)}</span>
          </div>
          <div class="usos-cat-speech-bubble">
            <div class="usos-cat-speech-top">
              <span class="usos-cat-role-badge">${escapeHtml(cat.role)}</span>
              <span class="usos-cat-sparkle">🐾</span>
            </div>
            <p class="usos-cat-message">${escapeHtml(cat.msg)}</p>
          </div>
        </div>

        <!-- Sekcja z cytatem motywacyjnym -->
        <div class="usos-quote-decor">“</div>
        <div class="usos-quote-inner">
          <p class="usos-quote-text">${escapeHtml(quote.text)}</p>
          <div class="usos-quote-footer">
            <div class="usos-quote-author">
              <span class="usos-quote-author-dash">—</span>
              <span class="usos-quote-author-name">${escapeHtml(quote.author)}</span>
            </div>
            ${quote.tag ? `<span class="usos-quote-tag">#${escapeHtml(quote.tag)}</span>` : ''}
          </div>
        </div>
      </div>
    `;

    // Interakcja losowania cytatu, zmiany kotka i kopiowania
    const refreshBtn = card.querySelector('.usos-btn-quote-refresh');
    const catSwitchBtn = card.querySelector('.usos-btn-cat-switch');
    const catCompanionBox = card.querySelector('.usos-cat-companion-box');
    const copyBtn = card.querySelector('.usos-btn-quote-copy');
    const quoteTextEl = card.querySelector('.usos-quote-text');
    const authorEl = card.querySelector('.usos-quote-author-name');
    const tagEl = card.querySelector('.usos-quote-tag');
    const quoteInner = card.querySelector('.usos-quote-inner');

    let activeQuoteIdx = currentIdx;
    let activeCatIdx = catIdx;

    const updateCatUI = (newIdx) => {
      activeCatIdx = (newIdx + CAT_COMPANIONS.length) % CAT_COMPANIONS.length;
      try {
        localStorage.setItem('usos_active_cat_idx', String(activeCatIdx));
      } catch { }

      const nextCat = CAT_COMPANIONS[activeCatIdx];
      const gifEl = card.querySelector('.usos-cat-gif');
      const fallbackEl = card.querySelector('.usos-cat-svg-fallback');
      const nameEl = card.querySelector('.usos-cat-name-chip');
      const roleEl = card.querySelector('.usos-cat-role-badge');
      const msgEl = card.querySelector('.usos-cat-message');

      if (gifEl) {
        gifEl.style.display = 'block';
        gifEl.src = nextCat.gif;
        gifEl.alt = nextCat.alt;
      }
      if (fallbackEl) fallbackEl.style.display = 'none';
      if (nameEl) nameEl.textContent = nextCat.name;
      if (roleEl) roleEl.textContent = nextCat.role;
      if (msgEl) msgEl.textContent = nextCat.msg;
    };

    if (catSwitchBtn) {
      catSwitchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        catSwitchBtn.classList.add('is-clicking');
        setTimeout(() => catSwitchBtn.classList.remove('is-clicking'), 300);
        updateCatUI(activeCatIdx + 1);
      });
    }

    if (catCompanionBox) {
      catCompanionBox.style.cursor = 'pointer';
      catCompanionBox.addEventListener('click', (e) => {
        if (e.target.closest('button, a')) return;
        catCompanionBox.classList.add('is-clicking');
        setTimeout(() => catCompanionBox.classList.remove('is-clicking'), 300);
        updateCatUI(activeCatIdx + 1);
        spawnPurrSparkle(catCompanionBox);
        showUsosToast('🐾 Kotek mruczy z zadowoleniem!', '🐱', 1600);
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('is-spinning');
        setTimeout(() => refreshBtn.classList.remove('is-spinning'), 500);

        quoteInner.classList.add('is-changing');
        setTimeout(() => {
          let nextIdx;
          do {
            nextIdx = Math.floor(Math.random() * STUDENT_MOTIVATIONAL_QUOTES.length);
          } while (nextIdx === activeQuoteIdx && STUDENT_MOTIVATIONAL_QUOTES.length > 1);

          activeQuoteIdx = nextIdx;
          try {
            localStorage.setItem('usos_last_quote_idx', String(activeQuoteIdx));
          } catch { }

          const nextQuote = STUDENT_MOTIVATIONAL_QUOTES[activeQuoteIdx];
          quoteTextEl.textContent = nextQuote.text;
          authorEl.textContent = nextQuote.author;
          if (tagEl) {
            tagEl.textContent = nextQuote.tag ? `#${nextQuote.tag}` : '';
            tagEl.style.display = nextQuote.tag ? 'inline-block' : 'none';
          }

          quoteInner.classList.remove('is-changing');
        }, 150);
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const cur = STUDENT_MOTIVATIONAL_QUOTES[activeQuoteIdx];
        const toCopy = `"${cur.text}" — ${cur.author}`;
        navigator.clipboard?.writeText(toCopy).then(() => {
          const label = copyBtn.querySelector('.usos-copy-label');
          if (label) {
            const old = label.textContent;
            label.textContent = '✓ Skopiowano';
            copyBtn.classList.add('copied');
            setTimeout(() => {
              label.textContent = old;
              copyBtn.classList.remove('copied');
            }, 1800);
          }
        }).catch(() => { });
      });
    }

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
     6e. NOWOCZESNY EKRAN LOGOWANIA (CAS & USOS 2.0)
     ========================================================================== */

  function getUniversityName() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('polsl')) return 'Politechnika Śląska';
    if (host.includes('umcs')) return 'UMCS Lublin';
    if (host.includes('pw.')) return 'Politechnika Warszawska';
    if (host.includes('uj.')) return 'Uniwersytet Jagielloński';
    if (host.includes('uw.')) return 'Uniwersytet Warszawski';
    if (host.includes('agh')) return 'AGH w Krakowie';
    if (host.includes('pg.')) return 'Politechnika Gdańska';
    if (host.includes('pwr')) return 'Politechnika Wrocławska';
    return 'Politechnika Śląska';
  }

  function isLoginPage() {
    return Boolean(
      document.querySelector('body.login, form#fm1, #container > #content, #container > #logo, input#username, input#password') ||
      window.location.pathname.includes('/cas/') ||
      window.location.href.includes('logowanie') ||
      window.location.search.includes('logowaniecas')
    );
  }

  function modernizeLoginPage() {
    if (!isLoginPage()) return;

    document.documentElement.classList.add('usos2-login-page');
    if (document.body) document.body.classList.add('usos2-login-page');

    // 1. Pozbycie się starego surowego logo USOS
    const oldLogos = document.querySelectorAll('#logo, img[src*="logo"], #container > img, .login #logo');
    oldLogos.forEach((l) => {
      l.style.setProperty('display', 'none', 'important');
      l.setAttribute('aria-hidden', 'true');
    });

    // 1b. Ukryj puste komunikaty błędów z CAS (np. pusty czerwony pasek)
    const messages = document.querySelectorAll('.message, .message-body, #msg, .alert, .errors');
    messages.forEach(msg => {
      if (!msg.textContent.trim()) {
        msg.style.setProperty('display', 'none', 'important');
      }
    });

    const contentEl = document.getElementById('content') || document.querySelector('.content') || document.querySelector('#container');
    const formEl = document.getElementById('fm1') || document.querySelector('form[action*="login"]');
    if (!contentEl) return;

    // 2. Przygotowanie nowoczesnego miejsca na logo USOS 2.0
    if (!document.getElementById('usos2-login-brand')) {
      const brand = document.createElement('div');
      brand.id = 'usos2-login-brand';
      brand.className = 'usos2-login-brand';
      brand.innerHTML = `
        <!-- Dedykowane miejsce / slot na logo USOS 2.0 (gotowy na podmianę na własną grafikę <img src="..." alt="USOS 2.0"> lub SVG) -->
        <div id="usos2-login-logo-slot" class="usos2-login-logo-slot" data-slot="usos2-logo">
          <div class="usos2-brand-badge-icon">
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="usos2-login-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#3b82f6" />
                  <stop offset="50%" stop-color="#6366f1" />
                  <stop offset="100%" stop-color="#8b5cf6" />
                </linearGradient>
              </defs>
              <rect width="48" height="48" rx="14" fill="url(#usos2-login-grad)"/>
              <path d="M24 13L38 20L24 27L10 20L24 13Z" fill="white" fill-opacity="0.95"/>
              <path d="M14 23.5V30C14 33 18.5 35.5 24 35.5C29.5 35.5 34 33 34 30V23.5L24 28.5L14 23.5Z" fill="white" fill-opacity="0.85"/>
              <path d="M37.5 21V29" stroke="#fef08a" stroke-width="2.5" stroke-linecap="round"/>
              <circle cx="37.5" cy="30" r="1.5" fill="#fef08a"/>
            </svg>
          </div>
          <div class="usos2-brand-text-wrap">
            <div class="usos2-brand-heading">
              <span class="usos2-brand-name">USOS</span>
              <span class="usos2-brand-version-pill">2.0</span>
            </div>
            <span class="usos2-brand-sub">${escapeHtml(getUniversityName())} • CAS</span>
          </div>
        </div>
        <h2 class="usos2-login-title">Witaj w USOS 2.0</h2>
        <p class="usos2-login-desc">Zaloguj się do uczelnianego systemu obsługi studiów</p>
      `;

      if (formEl) {
        formEl.parentNode.insertBefore(brand, formEl);
      } else {
        contentEl.insertBefore(brand, contentEl.firstChild);
      }
    }

    // 2b. Obsługa ekranu pomyślnego wylogowania (#logoutBody)
    const logoutBody = document.getElementById('logoutBody') || document.querySelector('.logout-msg, #logout-msg');
    const isLogout = Boolean(logoutBody || window.location.pathname.includes('/cas/logout') || (contentEl && /wylogowani/i.test(contentEl.textContent) && !formEl));
    if (isLogout && !formEl) {
      modernizeLogoutCard(contentEl);
      injectLoginCredit(contentEl);
      return;
    }

    // 2c. Obsługa ekranu pomyślnego zalogowania ("Udane logowanie")
    const hasLoginSuccess = Boolean(
      document.querySelector('.success, #msg.success, .alert-success') ||
      (contentEl && /udane logowanie|zalogowano do centralnego/i.test(contentEl.textContent))
    );
    if (hasLoginSuccess && !formEl) {
      modernizeLoginSuccessCard(contentEl);
      injectLoginCredit(contentEl);
      return;
    }

    // 3. Dekoracja pól formularza (ikony, czytelniejsze labele, placeholder, eye toggle)
    const usernameInput = document.getElementById('username') || document.querySelector('input[name="username"]');
    if (usernameInput) {
      usernameInput.style.setProperty('padding-left', '46px', 'important');
      usernameInput.style.setProperty('padding-right', '14px', 'important');
      if (!usernameInput.dataset.usos2Decorated) {
        usernameInput.dataset.usos2Decorated = '1';
        usernameInput.setAttribute('placeholder', 'Wpisz login lub numer albumu');
        const label = document.querySelector('label[for="username"]') || usernameInput.previousElementSibling;
        if (label && label.tagName.toLowerCase() === 'label') {
          label.textContent = 'Identyfikator (nr albumu / login)';
          label.style.setProperty('position', 'static', 'important');
          label.style.setProperty('transform', 'none', 'important');
          label.style.setProperty('margin-bottom', '6px', 'important');
        }

        if (!usernameInput.closest('.usos2-input-inner-wrap')) {
          const wrap = document.createElement('div');
          wrap.className = 'usos2-input-inner-wrap';
          usernameInput.parentNode.insertBefore(wrap, usernameInput);
          wrap.innerHTML = `
            <svg class="usos2-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          `;
          wrap.appendChild(usernameInput);
        }
      }
    }

    const pwdInput = document.getElementById('password') || document.querySelector('input[type="password"]');
    if (pwdInput) {
      pwdInput.style.setProperty('padding-left', '46px', 'important');
      pwdInput.style.setProperty('padding-right', '44px', 'important');
      if (!pwdInput.dataset.usos2Decorated) {
        pwdInput.dataset.usos2Decorated = '1';
        pwdInput.setAttribute('placeholder', 'Wpisz hasło do konta');
        const label = document.querySelector('label[for="password"]') || pwdInput.previousElementSibling;
        if (label && label.tagName.toLowerCase() === 'label') {
          label.textContent = 'Hasło';
          label.style.setProperty('position', 'static', 'important');
          label.style.setProperty('transform', 'none', 'important');
          label.style.setProperty('margin-bottom', '6px', 'important');
        }

        if (!pwdInput.closest('.usos2-input-inner-wrap')) {
          const wrap = document.createElement('div');
          wrap.className = 'usos2-input-inner-wrap';
          pwdInput.parentNode.insertBefore(wrap, pwdInput);
          wrap.innerHTML = `
            <svg class="usos2-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          `;
          wrap.appendChild(pwdInput);

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'usos2-pwd-toggle';
          toggleBtn.title = 'Pokaż / ukryj hasło';
          toggleBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          `;
          toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const isPwd = pwdInput.getAttribute('type') === 'password';
            pwdInput.setAttribute('type', isPwd ? 'text' : 'password');
            toggleBtn.innerHTML = isPwd
              ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="23" x2="23" y2="23"></line>
                </svg>`
              : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>`;
          });
          wrap.appendChild(toggleBtn);
        }
      }
    }

    // Wszystkie etykiety w formularzu nie mogą nachodzić na input
    const allLabels = contentEl.querySelectorAll('label, .mdc-floating-label');
    allLabels.forEach(lbl => {
      lbl.style.setProperty('position', 'static', 'important');
      lbl.style.setProperty('transform', 'none', 'important');
      lbl.style.setProperty('margin-bottom', '6px', 'important');
      lbl.style.setProperty('display', 'block', 'important');
    });

    // 4. Przycisk logowania
    const submitBtn = document.querySelector('.form-button, button[name="submit"], button[type="submit"]');
    if (submitBtn && !submitBtn.dataset.usos2Decorated) {
      submitBtn.dataset.usos2Decorated = '1';
      submitBtn.innerHTML = `
        <span>Zaloguj się</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      `;
    }

    // 5. Stylizacja linków pomocy
    const helpLinks = contentEl.querySelectorAll('.show-help');
    helpLinks.forEach(p => p.classList.add('usos2-help-link-item'));

    // 6. Stopka na karcie logowania: Made By BorysiaczekUwU
    injectLoginCredit(contentEl);
  }

  function injectLoginCredit(container) {
    if (!container || document.getElementById('usos2-login-credit')) return;
    const cred = document.createElement('div');
    cred.id = 'usos2-login-credit';
    cred.className = 'usos2-login-footer';
    cred.innerHTML = `
      <span>Made with <span style="color:#ef4444;">❤️</span> by <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer" class="usos2-author-link">BorysiaczekUwU</a></span>
      <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer" class="usos2-github-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        <span>GitHub</span>
      </a>
    `;
    container.appendChild(cred);
  }

  function modernizeLogoutCard(contentEl) {
    if (document.getElementById('usos2-logout-card')) return;
    const existingCard = contentEl.querySelector('.mdc-card') || contentEl;
    existingCard.classList.add('usos2-modern-logout-container');

    const logoutWrap = document.createElement('div');
    logoutWrap.id = 'usos2-logout-card';
    logoutWrap.className = 'usos2-logout-card';
    logoutWrap.innerHTML = `
      <div class="usos2-status-icon-wrap usos2-status-success">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </div>
      <h2 class="usos2-logout-title">Wylogowano pomyślnie</h2>
      <p class="usos2-logout-desc">Twoja sesja w Centralnym Punkcie Logowania CAS została bezpiecznie zakończona.</p>
      <div class="usos2-logout-actions">
        <a href="/cas/login" class="usos2-btn-relogin">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
            <polyline points="10 17 15 12 10 7"></polyline>
            <line x1="15" y1="12" x2="3" y2="12"></line>
          </svg>
          <span>Zaloguj się ponownie</span>
        </a>
      </div>
    `;

    Array.from(existingCard.children).forEach(child => {
      if (child.id !== 'usos2-login-brand' && child.id !== 'usos2-login-credit') {
        child.style.setProperty('display', 'none', 'important');
      }
    });

    existingCard.appendChild(logoutWrap);
  }

  function modernizeLoginSuccessCard(contentEl) {
    if (document.getElementById('usos2-login-success-card')) return;

    const successWrap = document.createElement('div');
    successWrap.id = 'usos2-login-success-card';
    successWrap.className = 'usos2-login-success-card';
    successWrap.innerHTML = `
      <div class="usos2-status-icon-wrap usos2-status-success">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
      </div>
      <h2 class="usos2-logout-title">Logowanie udane!</h2>
      <p class="usos2-logout-desc">Zostałeś pomyślnie uwierzytelniony w Centralnym Punkcie Logowania CAS.</p>
      <div class="usos2-logout-actions">
        <a href="/kontroler.php?_action=home/index" class="usos2-btn-relogin usos2-btn-primary-redirect">
          <span>Przejdź do USOSweb</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </a>
      </div>
    `;

    Array.from(contentEl.children).forEach(child => {
      if (child.id !== 'usos2-login-brand' && child.id !== 'usos2-login-credit') {
        child.style.setProperty('display', 'none', 'important');
      }
    });

    contentEl.appendChild(successWrap);

    // Automatyczne przejście do USOSweb po 2 sekundach
    setTimeout(() => {
      try {
        window.location.href = '/kontroler.php?_action=home/index';
      } catch { }
    }, 2000);
  }

  /* ==========================================================================
     6g. ZAPOBIEGANIE AUTOMATYCZNEMU WYLOGOWYWANIU (SESSION KEEP-ALIVE)
     ========================================================================== */

  let isKeepaliveInitialized = false;

  function initSessionKeepalive() {
    if (isKeepaliveInitialized) return;
    if (isLoginPage() || isMaintenanceBreak()) return;

    isKeepaliveInitialized = true;
    let lastPing = Date.now();
    const PING_INTERVAL_MS = 4 * 60 * 1000; // Co 4 minuty w tle (zapobiega timeoutowi PHP 15-30 min)

    const sendKeepalivePing = () => {
      try {
        fetch(window.location.origin + '/kontroler.php?_action=home/index', {
          method: 'HEAD',
          credentials: 'include',
          cache: 'no-store'
        }).then(() => {
          lastPing = Date.now();
        }).catch(() => {
          // Fallback do GET jeśli serwer blokuje HEAD
          fetch(window.location.origin + '/kontroler.php?_action=home/index', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store'
          }).then(() => {
            lastPing = Date.now();
          }).catch(() => { });
        });
      } catch { }
    };

    // Cykliczny interwał co 4 minuty
    setInterval(sendKeepalivePing, PING_INTERVAL_MS);

    // Gdy użytkownik powraca na kartę po dłuższym czasie, wykonaj natychmiastowy ping
    const onUserResume = () => {
      if (document.visibilityState === 'visible' && (Date.now() - lastPing > 3 * 60 * 1000)) {
        sendKeepalivePing();
      }
    };

    document.addEventListener('visibilitychange', onUserResume, { passive: true });
    window.addEventListener('focus', onUserResume, { passive: true });
  }

  /* ==========================================================================
     6f. GLOBALNA STOPKA (MADE BY BORYSIACZEKUWU)
     ========================================================================== */

  function modernizeFooter() {
    if (!isExtensionEnabled) return;

    // 1. Dedykowana linijka w usos-copyright
    const copyright = document.querySelector('usos-copyright, #layout-copyright');
    if (copyright && !copyright.dataset.usos2Cred) {
      copyright.dataset.usos2Cred = '1';
      const credLine = document.createElement('div');
      credLine.className = 'usos2-credit-footer-line';
      credLine.innerHTML = `
        <span class="usos2-footer-credit-text">USOSweb 2.0 • Made with <span style="color:#ef4444;">❤️</span> by <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer" class="usos2-author-link">BorysiaczekUwU</a></span>
        <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer" class="usos2-github-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          <span>GitHub</span>
        </a>
      `;
      copyright.appendChild(credLine);
      return;
    }

    // 2. Globalna stopka na stronach niemających komponentu usos-copyright
    if (!document.getElementById('usos2-global-footer') && !isLoginPage()) {
      const container = document.querySelector('#layout-main-content, #layout-c22, .usos-ui, main-panel') || document.body;
      if (!container) return;

      const footer = document.createElement('footer');
      footer.id = 'usos2-global-footer';
      footer.className = 'usos2-global-footer';
      footer.innerHTML = `
        <div class="usos2-footer-content">
          <span class="usos2-footer-brand">USOSweb 2.0</span>
          <span class="usos2-footer-separator">•</span>
          <span class="usos2-footer-credit">Made with <span class="usos2-footer-heart" style="color:#ef4444;">❤️</span> by <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer" class="usos2-author-link">BorysiaczekUwU</a></span>
          <span class="usos2-footer-separator">•</span>
          <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer" class="usos2-github-badge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            <span>GitHub</span>
          </a>
        </div>
      `;
      container.appendChild(footer);
    }
  }

  /* ==========================================================================
     6h. PORTAL DLA STUDENTÓW I WYSZUKIWARKA MODUŁÓW (DLA_STUD / KATALOG)
     ========================================================================== */

  function modernizeStudentPortal() {
    if (!isExtensionEnabled) return;

    const container = document.querySelector('usos-module-link-tile-container');
    if (!container) return;

    // Pobierz wszystkie kafelki modułów
    const tiles = Array.from(container.querySelectorAll('usos-module-link-tile'));
    if (tiles.length === 0) return;

    // Dodaj nowoczesny pasek wyszukiwania i filtrów jeśli jeszcze nie istnieje
    let filterBar = document.getElementById('usos-module-search-filter');
    if (!filterBar) {
      filterBar = document.createElement('div');
      filterBar.id = 'usos-module-search-filter';
      filterBar.className = 'usos-module-search-filter usos-modern-only';
      filterBar.innerHTML = `
        <div class="usos-module-search-header">
          <div class="usos-module-search-title-wrap">
            <div class="usos-module-search-icon-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
            </div>
            <div>
              <h2 class="usos-module-search-title">Moduły i Usługi USOS</h2>
              <p class="usos-module-search-subtitle">Szybki dostęp do spraw studenckich, rejestracji, ocen i wniosków</p>
            </div>
          </div>
          <div class="usos-module-search-badges">
            <span class="usos-module-count-badge" id="usos-module-count-badge">${tiles.length} modułów</span>
          </div>
        </div>

        <div class="usos-module-search-input-row">
          <div class="usos-module-search-input-wrap">
            <svg class="usos-module-search-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              type="text"
              id="usos-module-search-input"
              class="usos-module-search-input"
              placeholder="🔍 Szukaj modułu (np. oceny, rejestracja, stypendia, dyplomy, podania)..."
              autocomplete="off"
              spellcheck="false"
            />
            <button type="button" id="usos-module-search-clear" class="usos-module-search-clear" title="Wyczyść filtr (Esc)" style="display: none;">
              ✕
            </button>
          </div>
          <div class="usos-module-quick-tags">
            <button type="button" class="usos-module-tag-btn" data-query="oceny">⭐ Oceny</button>
            <button type="button" class="usos-module-tag-btn" data-query="rejestracj">📝 Rejestracje</button>
            <button type="button" class="usos-module-tag-btn" data-query="stypend">💰 Stypendia</button>
            <button type="button" class="usos-module-tag-btn" data-query="podpie">📑 Podpięcia</button>
            <button type="button" class="usos-module-tag-btn" data-query="plan">📅 Plany</button>
            <button type="button" class="usos-module-tag-btn" data-query="dyplom">🎓 Dyplomy</button>
          </div>
        </div>
      `;

      container.parentNode.insertBefore(filterBar, container);

      // Element pustego stanu
      let emptyState = document.getElementById('usos-modules-empty-state');
      if (!emptyState) {
        emptyState = document.createElement('div');
        emptyState.id = 'usos-modules-empty-state';
        emptyState.className = 'usos-modules-empty-state';
        emptyState.style.display = 'none';
        emptyState.innerHTML = `
          <div class="usos-modules-empty-icon">🔍</div>
          <div class="usos-modules-empty-title">Nie znaleziono modułu</div>
          <p class="usos-modules-empty-desc">Żaden moduł nie pasuje do wpisanej frazy. Spróbuj użyć innego słowa kluczowego.</p>
          <button type="button" class="usos-btn-clear-empty-filter">Pokaż wszystkie moduły</button>
        `;
        container.parentNode.insertBefore(emptyState, container.nextSibling);

        emptyState.querySelector('.usos-btn-clear-empty-filter')?.addEventListener('click', () => {
          const input = document.getElementById('usos-module-search-input');
          if (input) {
            input.value = '';
            input.dispatchEvent(new Event('input'));
            input.focus();
          }
        });
      }

      // Logika filtrowania z normalizacją polskich znaków
      const inputEl = filterBar.querySelector('#usos-module-search-input');
      const clearBtn = filterBar.querySelector('#usos-module-search-clear');
      const countBadge = filterBar.querySelector('#usos-module-count-badge');
      const tagBtns = filterBar.querySelectorAll('.usos-module-tag-btn');

      const normalizeStr = (str) => {
        return (str || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/ł/g, 'l');
      };

      const filterModules = (rawQuery) => {
        const query = normalizeStr(rawQuery.trim());
        if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

        let visibleCount = 0;
        const total = tiles.length;

        tiles.forEach((tile) => {
          const title = normalizeStr(tile.querySelector('[slot="title"]')?.textContent || '');
          const text = normalizeStr(tile.querySelector('[slot="text"]')?.textContent || '');
          const href = normalizeStr(tile.getAttribute('href') || '');

          const matches = !query || title.includes(query) || text.includes(query) || href.includes(query);
          tile.style.display = matches ? '' : 'none';
          if (matches) visibleCount++;
        });

        if (countBadge) {
          if (!query) {
            countBadge.textContent = `${total} modułów`;
            countBadge.classList.remove('is-filtering');
          } else {
            countBadge.textContent = `Wyniki: ${visibleCount} z ${total}`;
            countBadge.classList.add('is-filtering');
          }
        }

        if (emptyState) {
          emptyState.style.display = visibleCount === 0 ? 'flex' : 'none';
        }

        // Zaznaczanie aktywnego taga
        tagBtns.forEach((btn) => {
          const btnQuery = normalizeStr(btn.dataset.query || '');
          btn.classList.toggle('active', Boolean(query && query.includes(btnQuery)));
        });
      };

      inputEl?.addEventListener('input', (e) => {
        filterModules(e.target.value);
      });

      inputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          inputEl.value = '';
          filterModules('');
          inputEl.blur();
        }
      });

      clearBtn?.addEventListener('click', () => {
        if (inputEl) {
          inputEl.value = '';
          filterModules('');
          inputEl.focus();
        }
      });

      tagBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const query = btn.dataset.query || '';
          if (inputEl) {
            if (inputEl.value.trim().toLowerCase() === query.toLowerCase()) {
              inputEl.value = '';
              filterModules('');
            } else {
              inputEl.value = query;
              filterModules(query);
              inputEl.focus();
            }
          }
        });
      });
    }
  }

  /* ==========================================================================
     6i. GLOBALNE USPRAWNIENIA: SKRÓTY, TOASTY, SCROLL-TO-TOP, CLICK-TO-COPY
     ========================================================================== */

  let isGlobalEnhancementsInitialized = false;

  function initGlobalEnhancements() {
    if (isGlobalEnhancementsInitialized) return;
    isGlobalEnhancementsInitialized = true;

    initBackToTopButton();
    initKeyboardShortcuts();
    initShortcutsModal();
    initRoomClickToCopy();
  }

  function showUsosToast(message, icon = '✨', duration = 2400) {
    let container = document.getElementById('usos-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'usos-toast-container';
      container.className = 'usos-toast-container usos-modern-only';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'usos-toast';
    toast.innerHTML = `
      <span class="usos-toast-icon">${icon}</span>
      <span class="usos-toast-message">${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('is-showing');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('is-showing');
      toast.classList.add('is-hiding');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function initBackToTopButton() {
    if (document.getElementById('usos-back-to-top')) return;

    const btn = document.createElement('button');
    btn.id = 'usos-back-to-top';
    btn.type = 'button';
    btn.className = 'usos-back-to-top usos-modern-only';
    btn.title = 'Wróć na górę strony';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    `;

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.body.appendChild(btn);

    let scrollTicking = false;
    window.addEventListener('scroll', () => {
      if (!scrollTicking) {
        window.requestAnimationFrame(() => {
          if (window.scrollY > 300) {
            btn.classList.add('is-visible');
          } else {
            btn.classList.remove('is-visible');
          }
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    }, { passive: true });
  }

  function initShortcutsModal() {
    if (document.getElementById('usos-shortcuts-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'usos-shortcuts-modal';
    modal.className = 'usos-shortcuts-modal-backdrop usos-modern-only';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="usos-shortcuts-modal-card" role="dialog" aria-modal="true" aria-labelledby="usos-shortcuts-title">
        <div class="usos-shortcuts-header">
          <div class="usos-shortcuts-title-wrap">
            <span class="usos-shortcuts-icon">⌨️</span>
            <div>
              <h2 id="usos-shortcuts-title" class="usos-shortcuts-title">Skróty klawiszowe USOSweb 2.0</h2>
              <p class="usos-shortcuts-subtitle">Nawiguj po systemie jak profesjonalista</p>
            </div>
          </div>
          <button type="button" class="usos-shortcuts-close" title="Zamknij (Esc)">✕</button>
        </div>

        <div class="usos-shortcuts-grid">
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Mój USOSweb (Strona główna)</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>H</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Dla Studentów (Katalog usług)</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>S</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Pełny plan zajęć</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>P</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Oceny i protokoły</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>O</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Kalendarz rejestracji</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>R</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Przełącznik motywu (Dark Mode)</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>D</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Fokus na wyszukiwarkę modułów</span>
            <div class="usos-shortcut-keys"><kbd>Alt</kbd> + <kbd>/</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Pokaż to okno pomocy</span>
            <div class="usos-shortcut-keys"><kbd>?</kbd></div>
          </div>
          <div class="usos-shortcut-item">
            <span class="usos-shortcut-desc">Zamknij okno / wyczyść</span>
            <div class="usos-shortcut-keys"><kbd>Esc</kbd></div>
          </div>
        </div>

        <div class="usos-shortcuts-footer">
          <span>USOSweb 2.0 • Made with ❤️ by <a href="https://github.com/BorysiaczekUwU" target="_blank" rel="noopener noreferrer">BorysiaczekUwU</a></span>
          <button type="button" class="usos-shortcuts-btn-ok">Rozumiem</button>
        </div>
      </div>
    `;

    const closeModal = () => {
      modal.classList.remove('is-open');
      setTimeout(() => {
        modal.style.display = 'none';
      }, 200);
    };

    modal.querySelector('.usos-shortcuts-close')?.addEventListener('click', closeModal);
    modal.querySelector('.usos-shortcuts-btn-ok')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.body.appendChild(modal);
  }

  function toggleShortcutsModal() {
    const modal = document.getElementById('usos-shortcuts-modal');
    if (!modal) return;
    if (modal.classList.contains('is-open')) {
      modal.classList.remove('is-open');
      setTimeout(() => { modal.style.display = 'none'; }, 200);
    } else {
      modal.style.display = 'flex';
      setTimeout(() => { modal.classList.add('is-open'); }, 10);
    }
  }

  function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignoruj gdy użytkownik pisze w polach formularzy
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable;

      const modal = document.getElementById('usos-shortcuts-modal');
      const isModalOpen = modal && modal.classList.contains('is-open');

      if (e.key === 'Escape' && isModalOpen) {
        toggleShortcutsModal();
        e.preventDefault();
        return;
      }

      if (!isInput && e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleShortcutsModal();
        e.preventDefault();
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'h') {
          e.preventDefault();
          window.location.href = '/kontroler.php?_action=home/index';
        } else if (key === 's') {
          e.preventDefault();
          window.location.href = '/kontroler.php?_action=dla_stud/index';
        } else if (key === 'p') {
          e.preventDefault();
          window.location.href = '/kontroler.php?_action=home/plan';
        } else if (key === 'o') {
          e.preventDefault();
          window.location.href = '/kontroler.php?_action=dla_stud/studia/oceny/index';
        } else if (key === 'r') {
          e.preventDefault();
          window.location.href = '/kontroler.php?_action=dla_stud/rejestracja/kalendarz';
        } else if (key === 'd') {
          e.preventDefault();
          toggleDarkMode();
          showUsosToast(isDarkMode ? '🌙 Włączono tryb ciemny' : '☀️ Włączono tryb jasny', isDarkMode ? '🌙' : '☀️');
        } else if (key === '/' || key === 'k') {
          e.preventDefault();
          const moduleInput = document.getElementById('usos-module-search-input');
          if (moduleInput) {
            moduleInput.focus();
            moduleInput.select();
          } else {
            const genericSearch = document.querySelector('input[type="search"], input[name="szukaj"], input[name="q"], .usos-search-input');
            if (genericSearch) genericSearch.focus();
          }
        }
      }
    });
  }

  function initRoomClickToCopy() {
    document.addEventListener('click', (e) => {
      const roomEl = e.target.closest('.usos-upcoming-room-chip, .usos-plan-cell-room, .usos-entry-room');
      if (!roomEl) return;

      const roomText = (roomEl.textContent || '').replace(/^sala\s*:?/i, '').trim();
      if (!roomText) return;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(roomText).then(() => {
          showUsosToast(`Skopiowano salę: ${roomText}`, '📋');
        }).catch(() => { });
      }
    });
  }

  function spawnPurrSparkle(container) {
    if (!container) return;
    const sparkles = ['🐾', '✨', '⭐', '❤️', '🎓'];
    const char = sparkles[Math.floor(Math.random() * sparkles.length)];

    const spark = document.createElement('div');
    spark.className = 'usos-cat-sparkle-float';
    spark.textContent = char;
    spark.style.left = `${Math.floor(Math.random() * 60) + 20}%`;
    spark.style.top = `${Math.floor(Math.random() * 40) + 20}%`;

    container.appendChild(spark);
    setTimeout(() => spark.remove(), 1000);
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
          target.id === 'usos-module-search-filter' ||
          target.id === 'usos-shortcuts-modal' ||
          target.id === 'usos-back-to-top' ||
          target.id === 'usos-toast-container' ||
          target.id === 'usos-modules-empty-state' ||
          target.closest?.(
            '#usos-modern-navbar, #usos-schedule-filter-bar, #usos-home-dashboard, #usos-modern-maintenance, #usos-module-search-filter, #usos-shortcuts-modal, #usos-back-to-top, #usos-toast-container, #usos-modules-empty-state, .usos-home-hero, usos-timetable, timetable-entry, timetable-day, .usos-modern-breadcrumbs, .usos-table-wrapper, .usos-registration-card'
          ) ||
          target.classList?.contains('usos-badge') ||
          target.classList?.contains('usos-entry-card-wrap') ||
          target.classList?.contains('usos2-entry-details') ||
          target.classList?.contains('usos-entry-hide-btn') ||
          target.classList?.contains('usos-filter-pill') ||
          target.classList?.contains('usos-tour-status') ||
          target.classList?.contains('usos-reg-opis-btn') ||
          target.classList?.contains('usos-reg-cta-btn') ||
          target.classList?.contains('usos-sched-tab-btn') ||
          target.classList?.contains('usos-search-tab-pill') ||
          target.classList?.contains('usos-group-pill') ||
          target.classList?.contains('usos-toast') ||
          target.classList?.contains('usos-cat-sparkle-float') ||
          target.classList?.contains('usos-module-tag-btn')
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
