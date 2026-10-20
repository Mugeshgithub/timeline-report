// Vercel Web Analytics initialization
// This initializes the analytics queue before the external script loads
(function() {
  if (typeof window === 'undefined') return;
  
  // Initialize the analytics queue to capture early events
  window.va = window.va || function() {
    (window.vaq = window.vaq || []).push(arguments);
  };
})();
