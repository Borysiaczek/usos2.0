/**
 * USOSweb 2.0 - Popup Script
 * Obsługa przełączników stanu rozszerzenia oraz trybu ciemnego.
 */

document.addEventListener('DOMContentLoaded', () => {
  const extensionToggle = document.getElementById('extension-toggle');
  const darkModeToggle = document.getElementById('darkmode-toggle');

  // Bezpieczne wczytanie stanu z pamięci lokalnej rozszerzenia
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['extensionEnabled', 'darkMode'], (result) => {
      extensionToggle.checked = result.extensionEnabled !== false;
      const isDark = result.darkMode === true;
      darkModeToggle.checked = isDark;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    });

    // Zdarzenie: Przełączenie aktywacji rozszerzenia
    extensionToggle.addEventListener('change', (e) => {
      const isEnabled = e.target.checked;
      chrome.storage.local.set({ extensionEnabled: isEnabled }, () => {
        notifyActiveTabs();
      });
    });

    // Zdarzenie: Przełączenie trybu ciemnego
    darkModeToggle.addEventListener('change', (e) => {
      const isDark = e.target.checked;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      chrome.storage.local.set({ darkMode: isDark }, () => {
        notifyActiveTabs();
      });
    });
  }

  /**
   * Pomocnicza funkcja do natychmiastowego wymuszenia odświeżenia stylów
   */
  function notifyActiveTabs() {
    // chrome.storage.onChanged w content.js automatycznie wyłapuje zmiany,
    // ale możemy także zoptymalizować reakcję
  }
});
