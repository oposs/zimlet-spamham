import { createElement } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { ModalDialog } from '@zimbra-client/components';
import style from './style.less';

/*
 * Confirmation dialog. model: {title, text, headersOnly, wholeMail, cancel,
 * send}. onSend(content) gets 'full' or 'headers'; onClose closes it.
 */
export default function ReportDialog({ model, onSend, onClose }) {
	const [content, setContent] = useState('full');
	const pickHeaders = useCallback(() => setContent('headers'), []);
	const pickFull = useCallback(() => setContent('full'), []);
	const onAction = useCallback(() => onSend(content), [content, onSend]);

	return (
		<ModalDialog
			title={model.title}
			actionLabel={model.send}
			cancelLabel={model.cancel}
			onAction={onAction}
			onClose={onClose}
			contentClass={style.content}
		>
			<p class={style.text}>{model.text}</p>
			<div class={style.choice}>
				<label class={style.option}>
					<input type="radio" name="zhrContent" checked={content === 'headers'} onChange={pickHeaders} />
					{' '}{model.headersOnly}
				</label>
				<label class={style.option}>
					<input type="radio" name="zhrContent" checked={content === 'full'} onChange={pickFull} />
					{' '}{model.wholeMail}
				</label>
			</div>
		</ModalDialog>
	);
}
