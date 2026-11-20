// Server access for ZsrCore in the Modern client.
// opts: {batchClient, origin, csrfToken}. The batch client adds auth and
// CSRF, resolves to Body[<Name>Response], rejects on a fault and applies
// the change notifications of the response. The zimlet may run in a frame,
// so HTTP calls use absolute URLs.
// Content-Disposition of an upload; non-ASCII names per RFC 2231.
function contentDisposition(filename) {
	var name = String(filename).replace(/[\r\n]/g, '_');
	var ascii = name.replace(/["\\]|[^\x20-\x7e]/g, '_');
	var header = 'attachment; filename="' + ascii + '"';
	if (/[^\x20-\x7e]/.test(name)) {
		// RFC 2231: the real name, UTF-8 and percent-encoded.
		header += "; filename*=UTF-8''" + encodeURIComponent(name).replace(/['()*]/g, function (c) {
			return '%' + c.charCodeAt(0).toString(16).toUpperCase();
		});
	}
	return header;
}

function createTransport(opts, fetchFn, core) {
	const origin = String(opts.origin || '');
	const headers = (extra) => Object.assign({ 'X-Zimbra-Csrf-Token': opts.csrfToken }, extra);

	function soap(name, body) {
		const inner = {};
		for (const k of Object.keys(body)) {
			if (k !== '_jsns') {
				inner[k] = body[k];
			}
		}
		return opts.batchClient.jsonRequest({
			name: name.replace(/Request$/, ''),
			namespace: body._jsns,
			body: inner,
			singleRequest: true
		});
	}

	function fetchRaw(id) {
		return fetchFn(origin + '/service/home/~/?id=' + encodeURIComponent(id), {
			credentials: 'include',
			headers: headers({})
		}).then((res) => {
			if (!res.ok) {
				throw new Error('HTTP ' + res.status);
			}
			return res.arrayBuffer();
		}).then((buf) => new Uint8Array(buf));
	}

	function upload(bytes, filename, contentType) {
		return fetchFn(origin + '/service/upload?fmt=raw,extended', {
			method: 'POST',
			credentials: 'include',
			headers: headers({
				'Content-Type': contentType || 'message/rfc822',
				'Content-Disposition': contentDisposition(filename)
			}),
			body: bytes
		}).then((res) => {
			if (!res.ok) {
				throw new Error('HTTP ' + res.status);
			}
			return res.text();
		}).then((text) => core.parseUploadResponse(text));
	}

	return { soap, fetchRaw, upload };
}

module.exports = { createTransport, contentDisposition };
