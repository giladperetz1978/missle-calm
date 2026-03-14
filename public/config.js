(function () {
  var host = window.location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  window.APP_CONFIG = window.APP_CONFIG || {
    API_BASE_URL: isLocal ? "" : "https://missile-calm.onrender.com"
  };
})();
