<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="9.6.2">
<drawing>
<settings><setting alwaysvectorfont="no"/></settings>
<grid distance="0.1" unitdist="inch" unit="inch"/>
<layers>
<layer number="1" name="Top" color="7" fill="1" visible="yes" active="yes"/>
<layer number="2" name="Route2" color="7" fill="1" visible="yes" active="yes"/>
<layer number="15" name="Route15" color="7" fill="1" visible="yes" active="yes"/>
<layer number="16" name="Bottom" color="7" fill="1" visible="yes" active="yes"/>
<layer number="17" name="Pads" color="7" fill="1" visible="yes" active="yes"/>
<layer number="18" name="Vias" color="7" fill="1" visible="yes" active="yes"/>
<layer number="19" name="Unrouted" color="7" fill="1" visible="yes" active="yes"/>
<layer number="20" name="Dimension" color="7" fill="1" visible="yes" active="yes"/>
<layer number="21" name="tPlace" color="7" fill="1" visible="yes" active="yes"/>
<layer number="22" name="bPlace" color="7" fill="1" visible="yes" active="yes"/>
<layer number="25" name="tNames" color="7" fill="1" visible="yes" active="yes"/>
<layer number="26" name="bNames" color="7" fill="1" visible="yes" active="yes"/>
<layer number="27" name="tValues" color="7" fill="1" visible="yes" active="yes"/>
<layer number="28" name="bValues" color="7" fill="1" visible="yes" active="yes"/>
<layer number="51" name="tDocu" color="7" fill="1" visible="yes" active="yes"/>
<layer number="52" name="bDocu" color="7" fill="1" visible="yes" active="yes"/>
<layer number="91" name="Nets" color="7" fill="1" visible="yes" active="yes"/>
<layer number="92" name="Busses" color="7" fill="1" visible="yes" active="yes"/>
<layer number="93" name="Pins" color="7" fill="1" visible="yes" active="yes"/>
<layer number="94" name="Symbols" color="7" fill="1" visible="yes" active="yes"/>
<layer number="95" name="Names" color="7" fill="1" visible="yes" active="yes"/>
<layer number="96" name="Values" color="7" fill="1" visible="yes" active="yes"/>
<layer number="97" name="Info" color="7" fill="1" visible="yes" active="yes"/>
</layers>
<schematic xreflabel="%F%N/%S.%C%R">
<libraries>
<library name="demo">
<packages>
<package name="R0603">
<description>0603 chip resistor</description>
<smd name="1" x="-0.75" y="0" dx="0.9" dy="1" layer="1"/>
<smd name="2" x="0.75" y="0" dx="0.9" dy="1" layer="1"/>
<wire x1="-0.2" y1="0.65" x2="0.2" y2="0.65" width="0.15" layer="21"/>
<wire x1="-0.2" y1="-0.65" x2="0.2" y2="-0.65" width="0.15" layer="21"/>
<rectangle x1="-0.8" y1="-0.4" x2="0.8" y2="0.4" layer="51"/>
<text x="-1.5" y="1" size="0.8" layer="25">&gt;NAME</text>
<text x="-1.5" y="-1.8" size="0.8" layer="27">&gt;VALUE</text>
</package>
<package name="LED0603">
<smd name="C" x="-0.75" y="0" dx="0.9" dy="1" layer="1" roundness="30"/>
<smd name="A" x="0.75" y="0" dx="0.9" dy="1" layer="1" roundness="30"/>
<wire x1="-1.4" y1="0.7" x2="-1.4" y2="-0.7" width="0.2" layer="21"/>
<circle x="0" y="0" radius="0.3" width="0.1" layer="51"/>
<text x="-1.5" y="1" size="0.8" layer="25">&gt;NAME</text>
<text x="-1.5" y="-1.8" size="0.8" layer="27">&gt;VALUE</text>
</package>
<package name="HDR2">
<pad name="1" x="0" y="0" drill="1" diameter="1.7" shape="square"/>
<pad name="2" x="0" y="2.54" drill="1" diameter="1.7" shape="octagon"/>
<wire x1="-1.27" y1="-1.27" x2="1.27" y2="-1.27" width="0.2" layer="21"/>
<wire x1="1.27" y1="-1.27" x2="1.27" y2="3.81" width="0.2" layer="21"/>
<wire x1="1.27" y1="3.81" x2="-1.27" y2="3.81" width="0.2" layer="21"/>
<wire x1="-1.27" y1="3.81" x2="-1.27" y2="-1.27" width="0.2" layer="21"/>
<text x="-1.27" y="4.3" size="1" layer="25">&gt;NAME</text>
</package>
</packages>
<symbols>
<symbol name="R">
<wire x1="-2.54" y1="-1.016" x2="2.54" y2="-1.016" width="0.254" layer="94"/>
<wire x1="2.54" y1="-1.016" x2="2.54" y2="1.016" width="0.254" layer="94"/>
<wire x1="2.54" y1="1.016" x2="-2.54" y2="1.016" width="0.254" layer="94"/>
<wire x1="-2.54" y1="1.016" x2="-2.54" y2="-1.016" width="0.254" layer="94"/>
<pin name="1" x="-5.08" y="0" visible="off" length="short" direction="pas"/>
<pin name="2" x="5.08" y="0" visible="off" length="short" direction="pas" rot="R180"/>
<text x="-2.54" y="1.524" size="1.778" layer="95">&gt;NAME</text>
<text x="-2.54" y="-3.302" size="1.778" layer="96">&gt;VALUE</text>
</symbol>
<symbol name="LED">
<polygon width="0.254" layer="94">
<vertex x="-1.27" y="1.27"/>
<vertex x="-1.27" y="-1.27"/>
<vertex x="1.27" y="0"/>
</polygon>
<wire x1="1.27" y1="1.27" x2="1.27" y2="-1.27" width="0.254" layer="94"/>
<wire x1="0" y1="1.778" x2="1.27" y2="3.048" width="0.1524" layer="94" curve="-90"/>
<pin name="A" x="-5.08" y="0" visible="pad" length="short" direction="pas"/>
<pin name="C" x="5.08" y="0" visible="pad" length="short" direction="pas" rot="R180"/>
<text x="-2.54" y="3.81" size="1.778" layer="95">&gt;NAME</text>
<text x="-2.54" y="-3.81" size="1.778" layer="96">&gt;VALUE</text>
</symbol>
<symbol name="CONN2">
<wire x1="-2.54" y1="-2.54" x2="0" y2="-2.54" width="0.4064" layer="94"/>
<wire x1="0" y1="-2.54" x2="0" y2="5.08" width="0.4064" layer="94"/>
<wire x1="0" y1="5.08" x2="-2.54" y2="5.08" width="0.4064" layer="94"/>
<wire x1="-2.54" y1="5.08" x2="-2.54" y2="-2.54" width="0.4064" layer="94"/>
<pin name="1" x="5.08" y="0" length="middle" direction="pwr" rot="R180"/>
<pin name="2" x="5.08" y="2.54" length="middle" direction="pas" rot="R180" function="dot"/>
<text x="-2.54" y="5.842" size="1.778" layer="95">&gt;NAME</text>
<text x="-2.54" y="-5.08" size="1.778" layer="96">&gt;VALUE</text>
</symbol>
<symbol name="GND">
<wire x1="-1.905" y1="-2.54" x2="1.905" y2="-2.54" width="0.254" layer="94"/>
<wire x1="0" y1="0" x2="0" y2="-2.54" width="0.254" layer="94"/>
<pin name="GND" x="0" y="0" visible="off" length="point" direction="sup"/>
<text x="-1.905" y="-5.08" size="1.778" layer="96">&gt;VALUE</text>
</symbol>
<symbol name="VCC">
<wire x1="-1.27" y1="2.54" x2="1.27" y2="2.54" width="0.254" layer="94"/>
<wire x1="0" y1="0" x2="0" y2="2.54" width="0.254" layer="94"/>
<pin name="VCC" x="0" y="0" visible="off" length="point" direction="sup"/>
<text x="-1.27" y="3.302" size="1.778" layer="96">&gt;VALUE</text>
</symbol>
</symbols>
<devicesets>
<deviceset name="R" prefix="R" uservalue="yes">
<description>Resistor</description>
<gates><gate name="G$1" symbol="R" x="0" y="0"/></gates>
<devices><device name="0603" package="R0603"><connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects><technologies><technology name=""><attribute name="MPN" value="RC0603FR-07330RL"/></technology></technologies></device></devices>
</deviceset>
<deviceset name="LED" prefix="D" uservalue="yes">
<gates><gate name="G$1" symbol="LED" x="0" y="0"/></gates>
<devices><device name="0603" package="LED0603"><connects><connect gate="G$1" pin="A" pad="A"/><connect gate="G$1" pin="C" pad="C"/></connects><technologies><technology name=""/></technologies></device></devices>
</deviceset>
<deviceset name="CONN2" prefix="J">
<gates><gate name="G$1" symbol="CONN2" x="0" y="0"/></gates>
<devices><device name="" package="HDR2"><connects><connect gate="G$1" pin="1" pad="1"/><connect gate="G$1" pin="2" pad="2"/></connects><technologies><technology name=""/></technologies></device></devices>
</deviceset>
<deviceset name="GND" prefix="GND">
<gates><gate name="1" symbol="GND" x="0" y="0"/></gates>
<devices><device name=""><technologies><technology name=""/></technologies></device></devices>
</deviceset>
<deviceset name="VCC" prefix="P+">
<gates><gate name="1" symbol="VCC" x="0" y="0"/></gates>
<devices><device name=""><technologies><technology name=""/></technologies></device></devices>
</deviceset>
</devicesets>
</library>
</libraries>
<parts>
<part name="J1" library="demo" deviceset="CONN2" device="" value="PWR_IN"/>
<part name="R1" library="demo" deviceset="R" device="0603" value="330"/>
<part name="D1" library="demo" deviceset="LED" device="0603" value="RED"/>
<part name="GND1" library="demo" deviceset="GND" device=""/>
<part name="GND2" library="demo" deviceset="GND" device=""/>
<part name="P+1" library="demo" deviceset="VCC" device=""/>
</parts>
<sheets>
<sheet>
<description>Power input</description>
<plain>
<text x="10.16" y="35.56" size="2.54" layer="97">Demo design – sheet 1</text>
<text x="10.16" y="30.48" size="1.778" layer="97">Hand-made test fixture for Fusion PCB Viewer</text>
</plain>
<instances>
<instance part="J1" gate="G$1" x="15.24" y="12.7"/>
<instance part="R1" gate="G$1" x="38.1" y="20.32" smashed="yes" rot="R90">
<attribute name="NAME" x="40.64" y="20.32" size="1.778" layer="95"/>
<attribute name="VALUE" x="40.64" y="17.78" size="1.778" layer="96"/>
</instance>
<instance part="P+1" gate="1" x="30.48" y="17.78"/>
<instance part="GND1" gate="1" x="25.4" y="7.62"/>
</instances>
<busses/>
<nets>
<net name="VCC" class="0">
<segment>
<pinref part="J1" gate="G$1" pin="1"/>
<wire x1="20.32" y1="12.7" x2="30.48" y2="12.7" width="0.1524" layer="91"/>
<wire x1="30.48" y1="12.7" x2="38.1" y2="12.7" width="0.1524" layer="91"/>
<wire x1="38.1" y1="12.7" x2="38.1" y2="15.24" width="0.1524" layer="91"/>
<wire x1="30.48" y1="17.78" x2="30.48" y2="12.7" width="0.1524" layer="91"/>
<junction x="30.48" y="12.7"/>
<pinref part="R1" gate="G$1" pin="1"/>
<pinref part="P+1" gate="1" pin="VCC"/>
</segment>
</net>
<net name="GND" class="0">
<segment>
<pinref part="J1" gate="G$1" pin="2"/>
<wire x1="20.32" y1="15.24" x2="25.4" y2="15.24" width="0.1524" layer="91"/>
<wire x1="25.4" y1="15.24" x2="25.4" y2="7.62" width="0.1524" layer="91"/>
<pinref part="GND1" gate="1" pin="GND"/>
</segment>
</net>
<net name="LED_A" class="0">
<segment>
<pinref part="R1" gate="G$1" pin="2"/>
<wire x1="38.1" y1="25.4" x2="38.1" y2="27.94" width="0.1524" layer="91"/>
<wire x1="38.1" y1="27.94" x2="45.72" y2="27.94" width="0.1524" layer="91"/>
<label x="45.72" y="27.94" size="1.778" layer="95" xref="yes"/>
</segment>
</net>
</nets>
</sheet>
<sheet>
<description>LED</description>
<plain>
<text x="10.16" y="35.56" size="2.54" layer="97">Sheet 2</text>
</plain>
<instances>
<instance part="D1" gate="G$1" x="25.4" y="20.32" rot="MR0"/>
<instance part="GND2" gate="1" x="15.24" y="12.7"/>
</instances>
<busses/>
<nets>
<net name="LED_A" class="0">
<segment>
<pinref part="D1" gate="G$1" pin="A"/>
<wire x1="30.48" y1="20.32" x2="38.1" y2="20.32" width="0.1524" layer="91"/>
<label x="38.1" y="20.32" size="1.778" layer="95" xref="yes"/>
</segment>
</net>
<net name="GND" class="0">
<segment>
<pinref part="D1" gate="G$1" pin="C"/>
<wire x1="20.32" y1="20.32" x2="15.24" y2="20.32" width="0.1524" layer="91"/>
<wire x1="15.24" y1="20.32" x2="15.24" y2="12.7" width="0.1524" layer="91"/>
<pinref part="GND2" gate="1" pin="GND"/>
</segment>
</net>
</nets>
</sheet>
</sheets>
</schematic>
</drawing>
</eagle>
