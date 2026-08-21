import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the setup wizard', async () => {
    render(<App />);
    expect(await screen.findByText('Adolar Songster Setup')).toBeInTheDocument();
  });
});
