import { Variable } from './Variable';
import { Variables } from './Variables';
import { Runtime } from '../Runtime';
import * as Constants from '../Constants';

/*
 * Class that adds support for number based matrices.
 * This doesn't support string or character matrices.
 */
export class ParsedMatrix extends Variable {
	//**************************************************************************
	private _matrixName: string;
	private _fixedIndices: Array<number>;
	private _freeIndices: Array<number>;
	private _children: Array<Variable>;


	/***************************************************************************
	 * @param name the variable name without indices.
	 * @param value the contents of the variable.
	 * @param freeIndices the number of elements in each dimension.
	 * @param fixedIndices if this is a part of a larger matrix, the right-most
	 * indices that are used to access this submatrix.
	 * If the matrix is 2D, then rows are fixed before columns.
	 * If it's ND, dimensions > 2 are fixed before rows, and before columns.
	 * So fixing goes from~to: N-1, N-2, ..., 2, 0 (rows), 1(columns)
	 **************************************************************************/
	constructor(
		name: string = '',
		value: string = '',
		freeIndices: Array<number> = [],
		fixedIndices: Array<number> = []
	)
	{
		super();
		this._matrixName = name;
		this._name = ParsedMatrix.makeName(name, freeIndices, fixedIndices);
		this._value = value;
		this._freeIndices = freeIndices;
		this._fixedIndices = fixedIndices;
		// As a design decision free indices are used from right to left,
		// unless there are only two, in which case it's row,column (left to right)
		if(freeIndices.length !== 0) {
			this._numberOfChildren =
				freeIndices[(freeIndices.length < 3 ? 0 : freeIndices.length - 1)];

			if(this._numberOfChildren !== 0) {
				Variables.addReferenceTo(this);
			}
		}
	}


	//**************************************************************************
	public typename(): string { return 'matrix'; }


	//**************************************************************************
	public loads(type: string): boolean {
		return type === this.typename();
	}


	//**************************************************************************
	public load(
		name: string,
		runtime: Runtime,
		callback: (v: Variable) => void)
	{
		Variables.getSize(name, runtime, (size: Array<number>) => {
			const buildWith = (value: string) => {
				const matrix = new ParsedMatrix(name, value, size);
				Variables.addReferenceTo(matrix);
				callback(matrix);
			};

			const N = size.reduce((acc, val) => acc *= val);
			const is2DOrLess = size.length < 3;

			if(is2DOrLess && N <= Variables.getPrefetch()) {
				Variables.getValue(name, runtime, buildWith);
			} else {
				buildWith(size.join(Constants.SIZE_SEPARATOR));
			}
		});
	}


	//**************************************************************************
	public listChildren(
		runtime: Runtime,
		count: number,
		start: number,
		callback: (vars: Array<Variable>) => void
	): void
	{
		if(this._numberOfChildren === 0) {
			throw "Error: matrix has no children!";
		}

		const self = this;
		const cb = () => {
			if(count === 0) {
				callback(self._children);
			} else {
				callback(self._children.slice(start, count));
			}
		};

		if(this._children === undefined) {
			ParsedMatrix.parseChildren(
				this._matrixName,
				this._value,
				this._freeIndices,
				this._fixedIndices,
				(children: Array<ParsedMatrix>) => {
					self._children = children;
					cb();
				}
			);
		} else {
			cb();
		}
	}


	//**************************************************************************
	public static parseChildren(
		name: string,
		value: string,
		freeIndices: Array<number>,
		fixedIndices: Array<number>,
		callback: (vars: Array<ParsedMatrix>) => void
	)
	{
		const N = freeIndices.length;
		switch (N) {
			case 1: ParsedMatrix.parseChildren1D(name, value, freeIndices, fixedIndices, callback);
			case 2: ParsedMatrix.parseChildren2D(name, value, freeIndices, fixedIndices, callback);
			case 3: ParsedMatrix.parseChildren3D(name, value, freeIndices, fixedIndices, callback);
			default: ParsedMatrix.parseChildrenND(name, value, freeIndices, fixedIndices, callback);
		}
	}


	//**************************************************************************
	public static parseChildren1D(
		name: string,
		value: string,
		freeIndices: Array<number>,
		fixedIndices: Array<number>,
		callback: (vars: Array<ParsedMatrix>) => void
	): void
	{
		if(freeIndices.length !== 1) {
			throw `freeIndices.length: ${freeIndices.length}, expected 1!`;
		}

		const N = freeIndices[0];
		const childrenFreeIndices = [];
		const prefixedIndices = fixedIndices.slice(0, 1);
		const suffixedIndices = fixedIndices.slice(1);
		const vars = new Array<ParsedMatrix>(N);
		const values = ParsedMatrix.extractValuesLine(value);
		// This is the only line that needs to change when parsing imaginary numbers.
		const columns = values.trim().split(Constants.SEPARATOR);

		if(columns.length !== N) {
			throw `columns.length: ${columns.length} != ${N}!`;
		}

		for(let i = 0; i !== N; ++i) {
			const childrenFixedIndices = prefixedIndices.concat([i + 1].concat(suffixedIndices));
			vars[i] = new ParsedMatrix(name, columns[i], childrenFreeIndices, childrenFixedIndices);
		}

		callback(vars);
	}


	//**************************************************************************
	public static parseChildren2D(
		name: string,
		value: string,
		freeIndices: Array<number>,
		fixedIndices: Array<number>,
		callback: (vars: Array<ParsedMatrix>) => void
	): void
	{
		if(freeIndices.length !== 2) {
			throw `freeIndices.length: ${freeIndices.length}, expected 2!`;
		}

		// When parsing 2D matrices we break by rows and then columns.
		// This contrasts with ND which is from the right most index and leftwards.
		const N = freeIndices[0]; // #rows
		const childrenFreeIndices = [freeIndices[1]]; // #columns
		const vars = new Array<ParsedMatrix>(N);
		const rows = ParsedMatrix.extractValuesLines(value);

		if(rows.length !== N) {
			throw `rows.length: ${rows.length} != ${N}!`;
		}

		for(let i = 0; i !== N; ++i) {
			// Indices in matlab start at 1, hence the +1
			const childrenFixedIndices = [i + 1].concat(fixedIndices);
			const row = rows[i].trim();
			vars[i] = new ParsedMatrix(name, row, childrenFreeIndices, childrenFixedIndices);
		}

		callback(vars);
	}


	//**************************************************************************
	public static parseChildren3D(
		name: string,
		value: string,
		freeIndices: Array<number>,
		fixedIndices: Array<number>,
		callback: (vars: Array<ParsedMatrix>) => void
	): void
	{
		if(freeIndices.length !== 3) {
			throw `freeIndices.length: ${freeIndices.length}, expected 3!`;
		}

		const Nchildren = freeIndices[freeIndices.length - 1]; // #children
		const childrenFreeIndices = freeIndices.slice(0, freeIndices.length - 1);
		const childElementCount = childrenFreeIndices.reduce((acc, val) => acc *= val);
		const vars = new Array<ParsedMatrix>(Nchildren);
		let count = 0;

		const buildWith = (value: string) => {
			const childrenFixedIndices = [count + 1].concat(fixedIndices);
			const matrix = new ParsedMatrix(name, value, childrenFreeIndices, childrenFixedIndices);
			Variables.addReferenceTo(matrix);
			vars[count++] = matrix;

			if(count === Nchildren) {
				callback(vars);
			}
		};

		if(childElementCount <= Variables.getPrefetch()) {
			for(let i = 0; i !== Nchildren; ++i) {
				Variables.getValue(name, runtime, buildWith);
			}
		} else {
			const value = childrenFreeIndices.join(Constants.SIZE_SEPARATOR);
			for(let i = 0; i !== Nchildren; ++i) {
				buildWith(value);
			}
		}
	}


	//**************************************************************************
	public static parseChildrenND(
		name: string,
		value: string,
		freeIndices: Array<number>,
		fixedIndices: Array<number>,
		callback: (vars: Array<ParsedMatrix>) => void
	): void
	{
		if(freeIndices.length < 4) {
			throw `freeIndices.length: ${freeIndices.length}, expected > 3!`;
		}
		// When parsing ND matrices we just use load to directly.
		const Nchildren = freeIndices[freeIndices.length - 1]; // #children
		const childrenFreeIndices = freeIndices.slice(0, freeIndices.length - 1);
		const childValue = childrenFreeIndices.join(Constants.SIZE_SEPARATOR);
		const vars = new Array<ParsedMatrix>(Nchildren);

		for(let i = 0; i !== Nchildren; ++i) {
			// Indices in matlab start at 1, hence the +1
			const childrenFixedIndices = [i + 1].concat(fixedIndices);
			vars[i] = new ParsedMatrix(name, childValue, childrenFreeIndices, childrenFixedIndices);
		}

		callback(vars);
	}


	//**************************************************************************
	public static makeName(
		name: string,
		freeIndices: Array<number>,
		fixedIndices: Array<number>
	): string
	{
		let freeIndicesStr = '', fixedRowIndexStr = '', sufixedIndicesStr = '';

		if(fixedIndices.length === 0) {
			return name;
		}

		if(freeIndices.length !== 0) {
			freeIndicesStr = ':,'.repeat(freeIndices.length - 1) + ':';
		}

		if(fixedIndices.length !== 0) {
			let tail = fixedIndices;

			if(freeIndices.length === 1) {
				// There's at least 1 free column index and a fixed row index.
				fixedRowIndexStr += fixedIndices[0] + ',';
				tail = fixedIndices.slice(1);
			}

			if(tail.length !== 0) {
				sufixedIndicesStr += tail.join(',');

				if(freeIndices.length !== 0) {
					freeIndicesStr += ',';
				}
			}
		}

		return `${name}(${fixedRowIndexStr}${freeIndicesStr}${sufixedIndicesStr})`;
	}


	//**************************************************************************
	public static extractValuesLines(value: string): Array<string> {
		const inLines = value.trim().split('\n').filter(line => line.length !== 0);
		const N = inLines.length;
		const regex = /Columns \d+ through \d+:/;
		let outLines = new Array<string>();
		let multiColumnGroup = false;

		for(let i = 0; i !== N;) {
			if(inLines[i].match(regex) !== null) {
				if(!multiColumnGroup) {
					multiColumnGroup = true;
					++i; // skip line

					while(i !== N && inLines[i].match(regex) === null) {
						outLines.push(inLines[i++].trim());
					}
				} else {
					++i; // skip line
					let j = 0;
					while(i !== N && inLines[i].match(regex) === null) {
						outLines[j++] += Constants.SEPARATOR + inLines[i++].trim();
					}
				}
			} else {
				outLines.push(inLines[i++]);
			}
		}

		return outLines;
	}


	//**************************************************************************
	public static extractValuesLine(value: string): string {
		const lines = ParsedMatrix.extractValuesLines(value);
		return lines.join(Constants.SEPARATOR).trim();
	}
}