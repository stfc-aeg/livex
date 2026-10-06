import { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';

interface ResizeableOdinGraphProps {
    title: string;
    prop_data: number[] | number[][];
    x_data?: number[];
    width?: string;
    height?: string;
    responsive?: boolean;
    useResizeHandler?: boolean;
    num_x?: number;
    num_y?: number;
    type?: string;
    series_names?: string[];
    x_label?: string;
    y_label?: string;
    axis_limit?: [number, number];
    colorscale?: string[];
    zoom_event_handler?: any;
}

function ResizeableOdinGraph(props: ResizeableOdinGraphProps) {
        const {title, prop_data, x_data=null, width='100%', height='100%', responsive=true,useResizeHandler=true,
            num_x=null, type='scatter', series_names=[], x_label='', y_label='', axis_limit,
           colorscale="Portland", zoom_event_handler=null} = props;
    const [data, changeData] = useState([{}]);
    const [layout, changeLayout] = useState({});


    const get_array_dimenions = (data: number[] | number[][]) => {
        var x = data.length;
        var y = Array.isArray(data[0]) ? 2 : 1;
        // var z = (Array.isArray(data[0]) ? (Array.isArray(data[0][0]) ? data[0][0].length : 1) : 1);

        // console.log("(" + x + ", " + y + ")");
        return {x: x, y: y};
    }

    useEffect(() => {
        // console.log("Updating Data");
        var data_dims = get_array_dimenions(prop_data);
        var data = [];
        if(type == "scatter" || type == "line")
        {
            //one dimensional data set(s)
            if(data_dims.y > 1)
            {
                // multiple datasets
                const propData2D = prop_data as number[][];
                for(var i = 0; i<data_dims.x; i++){
                    const dataset = {
                        x: (x_data) ? x_data : Array.from(propData2D[i], (_, k) => k),
                        y: propData2D[i],
                        type: "scatter",
                        mode: type === "line" ? "lines" : undefined,
                        name: series_names[i] || null
                    }
                    data.push(dataset);
                }
            }
            else
            {
                const propData1D = prop_data as number[];
                const dataset = {
                    x: (x_data) ? x_data : Array.from(propData1D, (_, k) => k),
                    y: propData1D,
                    type: "scatter",
                    mode: type === "line" ? "lines" : undefined,
                    name: series_names[0] || "dataset"
                }
                data.push(dataset);
                
            }
            
            changeLayout({
                xaxis: {title: {text: x_label}, automargin: true},
                yaxis: {
                    autorange: !axis_limit,
                    range: axis_limit,
                    title: {text: y_label},
                    automargin: true
                },
                title: title,
                autosize: true
            });

        }
        else if(type == "heatmap" || type == "contour")
        {
            //2d dataset

            if(data_dims.y > 1)
            {
                //data is 2 dimensional,  easy to turn into a 2d heatmap
                const dataset = {
                    z: prop_data,
                    type: type,
                    xaxis: "x",
                    yaxis: "y",
                    colorscale: colorscale

                }
                data.push(dataset);
                
            }
            else
            {
                var reshape_data = [];
                for(var i = 0; i<prop_data.length; i+= num_x ?? 1)
                {
                    reshape_data.push(prop_data.slice(i, i+(num_x??0)));
                }
                //data is one dimensional, we need to reshape it?
                const dataset = {
                    z: reshape_data,
                    type: type,
                    xaxis: "x",
                    yaxis: "y",
                    colorscale: colorscale
                }
                data.push(dataset);
            }
            changeLayout({zaxis: {autorange: true}, title:title, autosize: true});
        }

        changeData(data);

    }, [prop_data, x_data, title, type, series_names, x_label, y_label, axis_limit, colorscale, num_x]);

    return (
        <Plot data={data} layout={layout} debug={true} onRelayout={zoom_event_handler} config={{responsive: responsive}} style={{height:height, width:width}} useResizeHandler={useResizeHandler}/>
    )
}


export default ResizeableOdinGraph;