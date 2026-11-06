(function () {
    "use strict";

    function setupToggle(button, panel, openClass) {
        if (!button || !panel) return;
        button.addEventListener("click", function (event) {
            event.stopPropagation();
            var open = button.getAttribute("aria-expanded") !== "true";
            button.setAttribute("aria-expanded", String(open));
            panel.classList.toggle(openClass, open);
        });
        document.addEventListener("click", function (event) {
            if (!panel.contains(event.target)) {
                button.setAttribute("aria-expanded", "false");
                panel.classList.remove(openClass);
            }
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
                button.setAttribute("aria-expanded", "false");
                panel.classList.remove(openClass);
                button.focus();
            }
        });
    }

    setupToggle(document.querySelector(".nav-toggle"), document.querySelector(".site-nav"), "is-open");
    setupToggle(document.querySelector(".language-btn"), document.querySelector(".language-selector"), "is-open");

    function setupLightbox() {
        var dialog = document.querySelector(".lightbox");
        var items = Array.prototype.slice.call(document.querySelectorAll("[data-gallery]"));
        if (!dialog || !items.length || typeof dialog.showModal !== "function") return;

        var image = dialog.querySelector("img");
        var caption = dialog.querySelector("figcaption");
        var counter = dialog.querySelector(".lightbox-count");
        var album = [];
        var current = 0;
        var touchStartX = null;

        function albumOf(name) {
            return items.filter(function (item) { return item.getAttribute("data-gallery") === name; });
        }

        function photoOf(item) {
            return item.tagName === "IMG" ? item : item.querySelector("img");
        }

        function show(index) {
            current = (index + album.length) % album.length;
            var item = album[current];
            var photo = photoOf(item);
            var figcaption = item.tagName === "IMG" ? null : item.querySelector("figcaption");
            image.removeAttribute("srcset");
            image.src = photo.getAttribute("src");
            if (photo.getAttribute("srcset")) {
                image.sizes = "(min-width: 1000px) 88vw, 100vw";
                image.srcset = photo.getAttribute("srcset");
            }
            image.alt = photo.alt;
            caption.textContent = figcaption ? figcaption.textContent : photo.alt;
            counter.textContent = album.length > 1 ? (current + 1) + " / " + album.length : "";
            dialog.classList.toggle("is-single", album.length < 2);
        }

        function open(name, item) {
            album = albumOf(name);
            show(Math.max(0, album.indexOf(item)));
            if (!dialog.open) dialog.showModal();
        }

        items.forEach(function (item) {
            if (item.closest("[hidden]")) return;
            var name = item.getAttribute("data-gallery");
            item.setAttribute("tabindex", "0");
            item.setAttribute("role", "button");
            item.addEventListener("click", function () { open(name, item); });
            item.addEventListener("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open(name, item);
                }
            });
        });

        document.querySelectorAll("[data-open-album]").forEach(function (button) {
            button.addEventListener("click", function (event) {
                event.stopPropagation();
                open(button.getAttribute("data-open-album"), null);
            });
        });

        dialog.querySelector(".lightbox-close").addEventListener("click", function () { dialog.close(); });
        dialog.querySelector(".lightbox-prev").addEventListener("click", function () { show(current - 1); });
        dialog.querySelector(".lightbox-next").addEventListener("click", function () { show(current + 1); });

        dialog.addEventListener("click", function (event) {
            if (event.target === dialog) dialog.close();
        });
        dialog.addEventListener("keydown", function (event) {
            if (event.key === "ArrowLeft") show(current - 1);
            if (event.key === "ArrowRight") show(current + 1);
        });
        dialog.addEventListener("touchstart", function (event) {
            touchStartX = event.touches[0].clientX;
        }, { passive: true });
        dialog.addEventListener("touchend", function (event) {
            if (touchStartX === null) return;
            var distance = event.changedTouches[0].clientX - touchStartX;
            if (Math.abs(distance) > 50) show(current + (distance < 0 ? 1 : -1));
            touchStartX = null;
        });
    }

    setupLightbox();

    function setupBookingForm() {
        var form = document.querySelector("[data-booking-form]");
        if (!form) return;

        var arrival = form.querySelector("#arrivee");
        var departure = form.querySelector("#depart");
        var adults = form.querySelector("#adultes");
        var children = form.querySelector("#enfants");
        var summary = form.querySelector("[data-summary]");
        var status = form.querySelector("[data-status]");
        var minNights = parseInt(form.getAttribute("data-min-nights"), 10) || 0;
        var maxGuests = 8;

        function text(element, name, value) {
            return element.getAttribute("data-text-" + name).replace("{n}", value);
        }

        var today = new Date().toISOString().slice(0, 10);
        var opening = form.getAttribute("data-open") || "";
        var closing = form.getAttribute("data-close") || "";
        var firstDay = opening > today ? opening : today;
        arrival.min = firstDay;
        departure.min = firstDay;
        if (closing) {
            arrival.max = closing;
            departure.max = closing;
        }

        function formatDay(isoDate) {
            return new Intl.DateTimeFormat(document.documentElement.lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
                .format(new Date(isoDate + "T00:00:00Z"));
        }

        function outsideSeason() {
            if (!opening || !closing) return false;
            return (arrival.value && (arrival.value < opening || arrival.value > closing))
                || (departure.value && (departure.value < opening || departure.value > closing));
        }

        function nightsBetween() {
            if (!arrival.value || !departure.value) return null;
            var milliseconds = new Date(departure.value) - new Date(arrival.value);
            return Math.round(milliseconds / 86400000);
        }

        function validate() {
            var nights = nightsBetween();
            var guests = parseInt(adults.value, 10) + parseInt(children.value, 10);
            var message = "";
            departure.setCustomValidity("");
            children.setCustomValidity("");

            if (arrival.value) departure.min = arrival.value;

            if (outsideSeason()) {
                message = text(summary, "closed").replace("{open}", formatDay(opening)).replace("{close}", formatDay(closing));
                departure.setCustomValidity(message);
            } else if (nights !== null && nights <= 0) {
                message = text(summary, "order");
                departure.setCustomValidity(message);
            } else if (nights !== null && minNights && nights < minNights) {
                message = text(summary, "min", minNights);
                departure.setCustomValidity(message);
            } else if (guests > maxGuests) {
                message = text(summary, "too-many");
                children.setCustomValidity(message);
            } else if (nights !== null) {
                message = text(summary, "nights", nights) + ", " + text(summary, "guests", guests);
            }
            summary.textContent = message;
        }

        var steppers = Array.prototype.slice.call(form.querySelectorAll(".stepper-btn"));

        function guestCount() {
            return (parseInt(adults.value, 10) || 0) + (parseInt(children.value, 10) || 0);
        }

        function refreshSteppers() {
            steppers.forEach(function (button) {
                var input = form.querySelector("#" + button.getAttribute("aria-controls"));
                var value = parseInt(input.value, 10) || 0;
                var blocked = button.getAttribute("data-step") === "1"
                    ? value >= parseInt(input.max, 10) || guestCount() >= maxGuests
                    : value <= parseInt(input.min, 10);
                button.setAttribute("aria-disabled", String(blocked));
            });
        }

        steppers.forEach(function (button) {
            button.addEventListener("click", function () {
                if (button.getAttribute("aria-disabled") === "true") return;
                var input = form.querySelector("#" + button.getAttribute("aria-controls"));
                var next = (parseInt(input.value, 10) || 0) + parseInt(button.getAttribute("data-step"), 10);
                input.value = Math.min(parseInt(input.max, 10), Math.max(parseInt(input.min, 10), next));
                input.dispatchEvent(new Event("change", { bubbles: true }));
            });
        });

        [arrival, departure, adults, children].forEach(function (field) {
            field.addEventListener("change", function () {
                validate();
                refreshSteppers();
            });
        });

        adults.addEventListener("input", refreshSteppers);
        children.addEventListener("input", refreshSteppers);
        form.addEventListener("reset", function () { setTimeout(refreshSteppers); });
        refreshSteppers();

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            validate();
            if (!form.reportValidity()) return;

            var button = form.querySelector("button[type=submit]");
            button.disabled = true;
            status.className = "form-status is-success";
            status.textContent = text(status, "sending");

            fetch(form.action, {
                method: "POST",
                headers: { "Accept": "application/json" },
                body: new FormData(form)
            })
                .then(function (response) {
                    return response.json().then(function (data) {
                        if (!response.ok || data.success === false) throw new Error(data.message);
                    });
                })
                .then(function () {
                    status.textContent = text(status, "success");
                    form.reset();
                    summary.textContent = "";
                })
                .catch(function () {
                    status.className = "form-status is-error";
                    status.textContent = text(status, "error");
                })
                .then(function () {
                    button.disabled = false;
                });
        });
    }

    setupBookingForm();

    function playPanoramaWhenVisible() {
        var bands = document.querySelectorAll(".quote-band--pan");
        if (!bands.length || !("IntersectionObserver" in window)) return;
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.35 });
        bands.forEach(function (band) { observer.observe(band); });
    }

    playPanoramaWhenVisible();
})();
