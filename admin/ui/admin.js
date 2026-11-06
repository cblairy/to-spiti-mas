(function () {
    "use strict";

    var dataForm = document.getElementById("data-form");
    var deployForm = document.getElementById("deploy-form");
    var dialog = document.getElementById("publish-dialog");
    var publishForm = document.getElementById("publish-form");
    var progress = publishForm.querySelector("progress");
    var publishStatus = document.getElementById("publish-status");
    var publishLog = document.getElementById("publish-log");
    var publishButton = document.getElementById("publish-button");

    function fieldLabels() {
        return Array.prototype.slice.call(dataForm.querySelectorAll("[data-field]"));
    }

    function getPath(object, path) {
        return path.split(".").reduce(function (node, key) { return node == null ? undefined : node[key]; }, object);
    }

    function setPath(object, path, value) {
        var keys = path.split(".");
        var last = keys.pop();
        var parent = keys.reduce(function (node, key) { return node[key] = node[key] || {}; }, object);
        parent[last] = value;
    }

    function setStatus(element, text, kind) {
        element.textContent = text;
        element.className = "status" + (kind ? " " + kind : "");
    }

    function markEmpty(empty) {
        fieldLabels().forEach(function (label) {
            label.classList.toggle("empty", empty.indexOf(label.getAttribute("data-field")) >= 0);
        });
    }

    function showErrors(errors) {
        fieldLabels().forEach(function (label) {
            var message = errors[label.getAttribute("data-field")] || "";
            label.classList.toggle("invalid", Boolean(message));
            label.querySelector(".field-error").textContent = message;
        });
    }

    function formatDate(iso) {
        return new Date(iso).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
    }

    function renderState(state) {
        var list = document.getElementById("checks");
        list.innerHTML = "";
        state.checks.forEach(function (check) {
            var item = document.createElement("li");
            item.className = (check.ok ? "ok" : "") + (check.optional ? " optional" : "");
            var mark = document.createElement("span");
            mark.className = "mark";
            mark.textContent = check.ok ? "✓" : "!";
            var text = document.createElement("span");
            text.textContent = check.label;
            if (!check.ok && check.detail) {
                var detail = document.createElement("small");
                detail.textContent = check.detail;
                text.appendChild(detail);
            }
            item.appendChild(mark);
            item.appendChild(text);
            list.appendChild(item);
        });
        var meta = [];
        if (state.lastBuild && state.lastBuild.date) meta.push("Site généré le " + formatDate(state.lastBuild.date) + ".");
        meta.push(state.lastPublish
            ? "Dernière publication le " + formatDate(state.lastPublish.date) + " (" + state.lastPublish.uploaded + " fichier(s) envoyé(s))."
            : "Jamais publié depuis cet ordinateur.");
        document.getElementById("build-meta").textContent = meta.join(" ");
        var problems = document.getElementById("build-problems");
        problems.innerHTML = "";
        (state.lastBuild ? state.lastBuild.problems : []).forEach(function (problem) {
            var item = document.createElement("li");
            item.textContent = problem;
            problems.appendChild(item);
        });
        var live = document.getElementById("live-link");
        live.hidden = !state.siteUrl || !state.lastPublish;
        live.href = state.siteUrl ? state.siteUrl + "/" : "#";
    }

    function refresh() {
        return fetch("/api/state").then(function (response) { return response.json(); }).then(renderState);
    }

    document.getElementById("build-button").addEventListener("click", function () {
        var button = this;
        button.disabled = true;
        postJson("/api/build", {}).then(refresh).then(function () { button.disabled = false; });
    });

    function postJson(url, body) {
        return fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    }

    function load() {
        fetch("/api/state").then(function (response) { return response.json(); }).then(function (state) {
            fieldLabels().forEach(function (label) {
                var value = getPath(state.data, label.getAttribute("data-field"));
                var input = label.querySelector("input");
                if (input.type === "checkbox") input.checked = value === true;
                else input.value = value == null ? "" : value;
            });
            renderState(state);
            deployForm.host.value = state.deploy.host || "";
            deployForm.user.value = state.deploy.user || "";
            deployForm.remoteDir.value = state.deploy.remoteDir || "";
            deployForm.tls.checked = state.deploy.tls !== false;
            markEmpty(state.empty);
        });
    }

    function save() {
        var body = {};
        fieldLabels().forEach(function (label) {
            var input = label.querySelector("input");
            setPath(body, label.getAttribute("data-field"), input.type === "checkbox" ? input.checked : input.value);
        });
        var status = document.getElementById("save-status");
        setStatus(status, "Enregistrement et génération du site…");
        return postJson("/api/data", body).then(function (response) {
            return response.json().then(function (result) { return { ok: response.ok, result: result }; });
        }).then(function (reply) {
            if (!reply.ok) {
                showErrors(reply.result.errors || {});
                setStatus(status, "Certaines valeurs sont incorrectes. Corrigez les champs en rouge.", "error");
                return false;
            }
            showErrors({});
            markEmpty(reply.result.empty);
            refresh();
            var remaining = reply.result.empty.length;
            setStatus(status, remaining
                ? "Enregistré. " + remaining + " valeur(s) encore vide(s), en rose. Elles devront être remplies avant de publier."
                : "Enregistré. L'aperçu est à jour.", "ok");
            return true;
        }).catch(function () {
            setStatus(status, "L'administration ne répond plus. Relancez « npm run admin ».", "error");
            return false;
        });
    }

    dataForm.addEventListener("submit", function (event) {
        event.preventDefault();
        save();
    });

    document.querySelectorAll("[data-preview]").forEach(function (link) {
        link.addEventListener("click", function (event) {
            event.preventDefault();
            var preview = window.open("about:blank", "_blank");
            save().then(function (saved) {
                if (!saved) {
                    if (preview) preview.close();
                    document.querySelector(".invalid") && document.querySelector(".invalid").scrollIntoView({ block: "center" });
                    return;
                }
                if (preview) preview.location = link.getAttribute("href");
                else window.open(link.getAttribute("href"), "_blank");
            });
        });
    });

    function deployValues() {
        return {
            host: deployForm.host.value,
            user: deployForm.user.value,
            remoteDir: deployForm.remoteDir.value,
            tls: deployForm.tls.checked
        };
    }

    var fieldNames = { host: "Serveur FTP", user: "Identifiant FTP", remoteDir: "Dossier du site", tls: "Connexion chiffrée", password: "Mot de passe" };

    function renderIssues(list, issues, okMessage) {
        list.innerHTML = "";
        ["host", "user", "remoteDir"].forEach(function (name) {
            deployForm[name].closest("label").classList.toggle("flag", issues.some(function (item) { return item.field === name; }));
        });
        if (!issues.length && okMessage) {
            var ok = document.createElement("li");
            ok.className = "ok";
            ok.textContent = okMessage;
            list.appendChild(ok);
            return;
        }
        issues.forEach(function (item) {
            var entry = document.createElement("li");
            var title = document.createElement("strong");
            title.textContent = (fieldNames[item.field] || "") + " : ";
            entry.appendChild(title);
            entry.appendChild(document.createTextNode(item.message));
            if (item.fix && deployForm[item.field]) {
                var button = document.createElement("button");
                button.type = "button";
                button.className = "ghost";
                button.textContent = "Remplacer par « " + item.fix + " »";
                button.addEventListener("click", function () {
                    deployForm[item.field].value = item.fix;
                    entry.remove();
                    deployForm[item.field].closest("label").classList.remove("flag");
                });
                var line = document.createElement("div");
                line.appendChild(button);
                entry.appendChild(line);
            }
            list.appendChild(entry);
        });
    }

    document.getElementById("test-connection").addEventListener("click", function () {
        var button = this;
        var status = document.getElementById("deploy-status");
        var list = document.getElementById("deploy-issues");
        button.disabled = true;
        setStatus(status, "Test en cours…");
        list.innerHTML = "";
        postJson("/api/diagnose", { deploy: deployValues(), password: deployForm.testPassword.value }).then(function (response) {
            return response.json();
        }).then(function (result) {
            var full = Boolean(deployForm.testPassword.value);
            setStatus(status, "");
            renderIssues(list, result.issues, full
                ? "Connexion réussie : serveur, identifiant, mot de passe et dossier sont corrects."
                : "Adresse et serveur corrects. Saisissez le mot de passe pour tester aussi la connexion.");
            refresh();
        }).catch(function () {
            setStatus(status, "L'administration ne répond plus. Relancez l'outil.", "error");
        }).then(function () {
            button.disabled = false;
            deployForm.testPassword.value = "";
        });
    });

    deployForm.addEventListener("submit", function (event) {
        event.preventDefault();
        postJson("/api/deploy", deployValues()).then(function (response) {
            response.clone().json().then(function (result) {
                renderIssues(document.getElementById("deploy-issues"), result.issues || []);
            });
            setStatus(document.getElementById("deploy-status"), response.ok ? "Réglages enregistrés." : "Échec de l'enregistrement.", response.ok ? "ok" : "error");
            refresh();
        });
    });

    document.getElementById("open-publish").addEventListener("click", function () {
        setStatus(publishStatus, "");
        document.getElementById("publish-issues").innerHTML = "";
        publishLog.textContent = "";
        progress.hidden = true;
        publishForm.password.value = "";
        dialog.showModal();
    });

    document.getElementById("close-publish").addEventListener("click", function () { dialog.close(); });

    function log(line) {
        publishLog.textContent += line + "\n";
        publishLog.scrollTop = publishLog.scrollHeight;
    }

    function handleEvent(event) {
        if (event.type === "step") {
            setStatus(publishStatus, event.message);
        } else if (event.type === "plan") {
            progress.hidden = event.upload === 0;
            progress.max = Math.max(event.upload, 1);
            progress.value = 0;
            setStatus(publishStatus, event.upload || event.remove
                ? "Envoi de " + event.upload + " fichier(s)…"
                : "Rien à envoyer : le site en ligne est déjà à jour.");
        } else if (event.type === "file") {
            progress.value = event.done;
            log("✓ " + event.file);
        } else if (event.type === "removed") {
            log("Supprimé en ligne : " + event.count + " ancien(s) fichier(s)");
        } else if (event.type === "error") {
            log("✗ " + event.file + " (code " + event.status + ")");
        } else if (event.type === "curl") {
            log(event.message);
        } else if (event.type === "fatal") {
            setStatus(publishStatus, event.message, "error");
        } else if (event.type === "done") {
            if (event.failed.length) {
                setStatus(publishStatus, event.failed.length + " fichier(s) non envoyé(s). Vérifiez le mot de passe et la connexion, puis relancez : l'envoi reprendra où il s'est arrêté.", "error");
            } else if (event.uploaded || event.removed) {
                setStatus(publishStatus, "Publié. " + event.uploaded + " fichier(s) envoyé(s). Le site en ligne est à jour.", "ok");
            }
            refresh();
        }
    }

    publishForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!publishForm.password.value) return;
        publishButton.disabled = true;
        publishLog.textContent = "";
        setStatus(publishStatus, "Vérification des réglages et de la connexion…");

        document.getElementById("publish-issues").innerHTML = "";
        postJson("/api/publish", { password: publishForm.password.value, force: publishForm.force.checked, deploy: deployValues() }).then(function (response) {
            if (!response.ok) {
                return response.json().then(function (result) {
                    if (result.issues) {
                        renderIssues(document.getElementById("publish-issues"), result.issues);
                        renderIssues(document.getElementById("deploy-issues"), result.issues);
                    }
                    var details = (result.empty || []).length ? " Remplissez les champs en rose." : "";
                    if (result.empty) markEmpty(result.empty);
                    (result.problems || []).forEach(log);
                    setStatus(publishStatus, result.message + details, "error");
                });
            }
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = "";
            function read() {
                return reader.read().then(function (chunk) {
                    if (chunk.done) return;
                    buffer += decoder.decode(chunk.value, { stream: true });
                    var lines = buffer.split("\n");
                    buffer = lines.pop();
                    lines.filter(Boolean).forEach(function (line) { handleEvent(JSON.parse(line)); });
                    return read();
                });
            }
            return read();
        }).catch(function () {
            setStatus(publishStatus, "L'administration ne répond plus. Relancez « npm run admin ».", "error");
        }).then(function () {
            publishButton.disabled = false;
            publishForm.password.value = "";
        });
    });

    load();
})();
