MKM.renderCaseStudy().then(function (result) {
  if (result && result.caseStudy) {
    MKM.setupGate(result.caseStudy, result.site && result.site.caseStudies);
  }
  if (window.MKM.onDataLoaded) window.MKM.onDataLoaded(result.site);
}).finally(function () {
  window.MKM_reveal();
});
