MKM.renderHome().then(function (site) {
  if (window.MKM.onDataLoaded) window.MKM.onDataLoaded(site);
}).finally(function () {
  window.MKM_reveal();
});
