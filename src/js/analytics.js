// Vercel Web Analytics initialization
// This initializes the analytics queue and will be loaded by the external script
(function() {
  if (typeof window === 'undefined') return;
  
  // Initialize the analytics queue
  window.va = window.va || function() {
    (window.vaq = window.vaq || []).push(arguments);
  };
})();
