document.addEventListener('DOMContentLoaded', function () {
    var progressBar = document.querySelector('.scroll-progress-bar');
    if (progressBar) {
        window.addEventListener('scroll', function () {
            var scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
            var scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
            if (scrollHeight <= 0) {
                progressBar.style.width = '100%';
                return;
            }
            var scrollPercentage = (scrollTop / scrollHeight) * 100;
            progressBar.style.width = scrollPercentage + '%';
        });
    }
});
