declare module 'react-katex' {
  import * as React from 'react';

  export interface MathComponentProps {
    math: string;
    block?: boolean;
    errorColor?: string;
    renderError?: (error: Error) => React.ReactNode;
  }

  export class InlineMath extends React.Component<MathComponentProps> {}
  export class BlockMath extends React.Component<MathComponentProps> {}
}