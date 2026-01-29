/**
 * Client-side post search – filters by title and excerpt.
 * Keyboard: ArrowUp/ArrowDown to move, Enter to open selected result.
 * Expects window.__SEARCH_POSTS__ = [ { title, url, date, excerpt }, ... ]
 */
(function () {
    var input = document.getElementById('js-search__input');
    var resultsEl = document.getElementById('js-search__results');
    var posts = window.__SEARCH_POSTS__ || [];
    var minChars = 2;
    var currentMatches = [];
    var currentIndex = -1;

    if (!input || !resultsEl) return;

    function formatDate(iso) {
        try {
            var d = new Date(iso);
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) {
            return '';
        }
    }

    function escapeHtml(s) {
        if (!s) return '';
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    function setActiveIndex(index) {
        var items = resultsEl.querySelectorAll('li:not(.site-search__no-results)');
        if (items.length === 0) return;
        currentIndex = (index + items.length) % items.length;
        items.forEach(function (li, i) {
            li.classList.toggle('site-search__result--active', i === currentIndex);
        });
        var active = items[currentIndex];
        if (active) {
            // Use requestAnimationFrame to avoid blocking input
            requestAnimationFrame(function() {
                active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
        }
    }

    function showResults(matches) {
        currentMatches = matches.slice(0, 15);
        currentIndex = 0;
        resultsEl.classList.remove('site-search__results--hidden');
        resultsEl.innerHTML = currentMatches.map(function (post) {
            var dateStr = formatDate(post.date);
            return '<li><a href="' + post.url + '">' +
                '<span class="site-search__result-title">' + escapeHtml(post.title) + '</span>' +
                (dateStr ? '<span class="site-search__result-date">' + dateStr + '</span>' : '') +
                '</a></li>';
        }).join('');
        setActiveIndex(0);
    }

    function hideResults() {
        resultsEl.classList.add('site-search__results--hidden');
        resultsEl.innerHTML = '';
        currentMatches = [];
        currentIndex = -1;
    }

    function isResultsVisible() {
        return !resultsEl.classList.contains('site-search__results--hidden') && resultsEl.querySelectorAll('li').length > 0;
    }

    function getResultLinks() {
        return resultsEl.querySelectorAll('li:not(.site-search__no-results) a');
    }

    input.addEventListener('input', function (e) {
        var q = (input.value || '').trim().toLowerCase();
        if (q.length < minChars) {
            hideResults();
            return;
        }
        var matches = posts.filter(function (post) {
            var title = (post.title || '').toLowerCase();
            var excerpt = (post.excerpt || '').toLowerCase();
            return title.indexOf(q) !== -1 || excerpt.indexOf(q) !== -1;
        });
        if (matches.length === 0) {
            currentMatches = [];
            currentIndex = -1;
            resultsEl.classList.remove('site-search__results--hidden');
            resultsEl.innerHTML = '<li class="site-search__no-results">No posts found.</li>';
        } else {
            showResults(matches);
        }
    });

    input.addEventListener('focus', function () {
        var q = (input.value || '').trim();
        if (q.length >= minChars && resultsEl.querySelector('li')) {
            resultsEl.classList.remove('site-search__results--hidden');
            var links = getResultLinks();
            if (links.length > 0) {
                setActiveIndex(0);
            }
        }
    });

    input.addEventListener('keydown', function (e) {
        // Only handle navigation keys when results are visible and we have matches
        if (!isResultsVisible()) {
            return; // Let all keys pass through normally
        }
        var links = getResultLinks();
        if (links.length === 0) {
            return; // Let all keys pass through normally
        }

        // Only intercept specific navigation keys
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            setActiveIndex(currentIndex + 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            setActiveIndex(currentIndex - 1);
        } else if (e.key === 'Enter' && currentIndex >= 0 && currentMatches[currentIndex]) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = currentMatches[currentIndex].url;
        }
        // All other keys (letters, numbers, backspace, etc.) pass through normally - no preventDefault
    });


    document.addEventListener('click', function (e) {
        if (!e.target.closest('.site-search')) {
            hideResults();
        }
    });

    document.addEventListener('keydown', function (e) {
        // Only handle Escape when search input is focused
        if (e.key === 'Escape' && document.activeElement === input) {
            input.blur();
            hideResults();
        }
        // Only handle '/' when not in any input/textarea
        if (e.key === '/' && document.activeElement !== input && !e.target.matches('input, textarea')) {
            e.preventDefault();
            input.focus();
        }
    });
})();
