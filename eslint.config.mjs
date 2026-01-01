import next from "eslint-config-next";

const config = [
	{
		ignores: [
			"dist-electron/**",
			".next/**",
			"out/**",
			"node_modules/**",
		],
	},
	...next,
];

export default config;
