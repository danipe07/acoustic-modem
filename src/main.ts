import './ui/styles.css';
import { startApp } from './ui/app.ts';

const root = document.querySelector<HTMLElement>('#app');
if (root) startApp(root);
