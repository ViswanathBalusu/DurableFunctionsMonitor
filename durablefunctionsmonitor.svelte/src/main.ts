import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('root');
if (!target) {
  throw new Error('Durable Functions Monitor: #root element not found');
}

const app = mount(App, { target });

export default app;
